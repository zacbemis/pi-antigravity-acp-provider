import type {
	NewSessionResponse,
	SessionConfigOption,
	SessionConfigSelectOption,
	SessionModeState,
} from "@agentclientprotocol/sdk/unstable";
import { z } from "zod";

import { splitEffortSuffix } from "../models.js";
import { AntigravityAcpError } from "./errors.js";

/** Antigravity's pre-config-option model metadata remains on older ACP v1 servers. */
export interface AcpModelInfo {
	modelId: string;
	name: string;
}

export interface SessionState {
	modes?: SessionModeState | null;
	configOptions?: SessionConfigOption[] | null;
	models?: { currentModelId: string; availableModels: AcpModelInfo[] } | null;
}

export type AcpNewSessionResponse = NewSessionResponse & SessionState;
type SelectOption = Extract<SessionConfigOption, { type: "select" }>;
const valueSchema = z.object({ value: z.string(), name: z.string() });
const selectorBase = { id: z.string(), name: z.string(), category: z.string().nullish() };
const stateSchema = z.object({
	modes: z.object({ currentModeId: z.string(), availableModes: z.array(z.object({ id: z.string(), name: z.string() })) }).nullish(),
	configOptions: z.array(z.discriminatedUnion("type", [
		z.object({ ...selectorBase, type: z.literal("select"), currentValue: z.string(), options: z.union([
			z.array(valueSchema),
			z.array(z.object({ group: z.string(), name: z.string(), options: z.array(valueSchema) })),
		]) }),
		z.object({ ...selectorBase, type: z.literal("boolean"), currentValue: z.boolean() }),
	])).nullish(),
	models: z.object({ currentModelId: z.string(), availableModels: z.array(z.object({ modelId: z.string(), name: z.string() })) }).nullish(),
});

/** Validate the state we use explicitly, preserving Antigravity's legacy model
 * metadata even when it is absent from the SDK's generated response types. */
export function decodeSessionState(response: unknown): SessionState {
	const parsed = stateSchema.safeParse(response);
	if (!parsed.success) throw new AntigravityAcpError("protocol", "Invalid ACP session configuration");
	// JSON responses cannot contain explicit undefined properties; Zod's optional
	// property inference is broader than the SDK's exact-optional declarations.
	return parsed.data as SessionState;
}

export type SessionSelectorCategory = "model" | "mode" | "thought_level";

export function findSessionSelector(state: SessionState, category: SessionSelectorCategory): SelectOption | undefined {
	return state.configOptions?.find((option): option is SelectOption =>
		option.type === "select" &&
		(option.category === category ||
			option.id === category ||
			(category === "thought_level" && option.id === "thinking_level")),
	);
}

export function selectorValues(option: SelectOption): SessionConfigSelectOption[] {
	return option.options.flatMap((entry) => "options" in entry ? entry.options : [entry]);
}

/** How a session applies one model ID: an exact `model` selector value, or a
 * base value followed by a `thought_level` value. */
interface ModelSelection {
	/** `model` selector value; the whole ID when `effort` is absent. */
	base: string;
	/** `thought_level` value. */
	effort?: string;
}

/** Every ID a session can select, keyed by exact ID, in discovery order. */
type ModelInventory = Map<string, { info: AcpModelInfo; selection: ModelSelection }>;

/** A value that already ends in a thought level names a whole ID. */
function carriesLevel(id: string, levels: SessionConfigSelectOption[]): boolean {
	return splitEffortSuffix(id) !== undefined ||
		levels.some((option) => option.value.length > 0 && id.endsWith(`-${option.value}`));
}

/** Selector values that do not already carry a level. Only these take effort variants. */
function basesOf(options: SessionConfigSelectOption[], levels: SessionConfigSelectOption[]): string[] {
	return options.filter((option) => !carriesLevel(option.value, levels)).map((option) => option.value);
}

/** The selectors that produce `modelId`: a selector value verbatim, or the
 * longest base value extended by a suffix. */
function selectionFor(modelId: string, values: string[], bases: string[]): ModelSelection | undefined {
	if (values.includes(modelId)) return { base: modelId };
	let selection: ModelSelection | undefined;
	for (const base of bases) {
		if (modelId.startsWith(`${base}-`) && modelId.length > base.length + 1 && base.length > (selection?.base.length ?? 0)) {
			selection = { base, effort: modelId.slice(base.length + 1) };
		}
	}
	return selection;
}

/** The server's explicit `models` list, when the selectors vouch for it. Undefined
 * on any disagreement, so a repeated, stale, base-only, or incomplete list falls
 * back to the selectors instead of being trusted. */
function legacyInventory(
	legacy: AcpModelInfo[] | undefined,
	values: string[],
	bases: string[],
	currentBase: string | undefined,
	levels: string[],
): ModelInventory | undefined {
	if (!legacy) return undefined;
	const inventory: ModelInventory = new Map();
	for (const info of legacy) {
		if (inventory.has(info.modelId)) return undefined;
		const selection = selectionFor(info.modelId, values, bases);
		if (!selection) return undefined;
		if (selection.effort !== undefined && !levels.includes(selection.effort) && splitEffortSuffix(info.modelId)?.effort !== selection.effort) {
			return undefined;
		}
		inventory.set(info.modelId, { info, selection });
	}
	// Each selector value is listed as itself or as its variants, never both or neither.
	const whole = new Set<string>();
	const variants = new Map<string, Set<string>>();
	for (const { selection } of inventory.values()) {
		if (selection.effort === undefined) whole.add(selection.base);
		else variants.set(selection.base, (variants.get(selection.base) ?? new Set()).add(selection.effort));
	}
	const listedOnce = (value: string) => whole.has(value) !== variants.has(value);
	if (!values.every(listedOnce)) return undefined;
	// The thought selector offers the current model's levels, so the list must offer it exactly those.
	if (currentBase !== undefined && levels.length > 0) {
		const offered = variants.get(currentBase);
		if (!offered || offered.size !== levels.length || !levels.every((level) => offered.has(level))) return undefined;
	}
	return inventory;
}

/** Cross-product of the selectors: a value that already carries a level is a
 * whole ID; every other value is offered once per level. */
function synthesizedInventory(options: SessionConfigSelectOption[], levels: SessionConfigSelectOption[]): ModelInventory {
	const inventory: ModelInventory = new Map();
	for (const model of options) {
		if (levels.length === 0 || carriesLevel(model.value, levels)) {
			inventory.set(model.value, { info: { modelId: model.value, name: model.name }, selection: { base: model.value } });
			continue;
		}
		for (const level of levels) {
			inventory.set(`${model.value}-${level.value}`, {
				info: { modelId: `${model.value}-${level.value}`, name: `${model.name} (${level.name})` },
				selection: { base: model.value, effort: level.value },
			});
		}
	}
	return inventory;
}

/** One inventory for discovery and selection. */
function modelInventory(state: SessionState, selector: SelectOption, levels: SessionConfigSelectOption[]): ModelInventory {
	const options = selectorValues(selector);
	const bases = basesOf(options, levels);
	const values = options.map((option) => option.value);
	// Resolve a qualified current value to its base before checking its levels.
	const current = selectionFor(selector.currentValue, values, bases)?.base;
	const currentBase = current !== undefined && bases.includes(current) ? current : undefined;
	return legacyInventory(state.models?.availableModels, values, bases, currentBase, levels.map((level) => level.value))
		?? synthesizedInventory(options, levels);
}

/** Reverse the inventory used by discovery, including levels the current
 * thought selector lacks, without misinterpreting a whole ID. */
export function splitSessionModelId(state: SessionState, modelId: string): { base: string; effort: string } | undefined {
	const selector = findSessionSelector(state, "model");
	const thought = findSessionSelector(state, "thought_level");
	if (!selector || !thought) return undefined;
	const selection = modelInventory(state, selector, selectorValues(thought)).get(modelId)?.selection;
	return selection?.effort === undefined ? undefined : { base: selection.base, effort: selection.effort };
}

export function sessionModels(state: SessionState): { currentModelId: string; availableModels: AcpModelInfo[] } | undefined {
	const selector = findSessionSelector(state, "model");
	if (!selector) return state.models ?? undefined;
	const thought = findSessionSelector(state, "thought_level");
	const levels = thought ? selectorValues(thought) : [];
	const bases = basesOf(selectorValues(selector), levels);
	const inventory = modelInventory(state, selector, levels);
	// Legacy currentModelId may be stale; derive this ID from the live selectors.
	const level = bases.length > 0 && levels.length > 0 && !carriesLevel(selector.currentValue, levels)
		? thought?.currentValue
		: undefined;
	const currentModelId = level ? `${selector.currentValue}-${level}` : selector.currentValue;
	return {
		currentModelId,
		availableModels: [...inventory.values()].map((entry) => entry.info),
	};
}

export function sessionModes(state: SessionState): SessionModeState | null | undefined {
	const selector = findSessionSelector(state, "mode");
	if (!selector) return state.modes;
	return {
		currentModeId: selector.currentValue,
		availableModes: selectorValues(selector).map((option) => ({ id: option.value, name: option.name })),
	};
}

