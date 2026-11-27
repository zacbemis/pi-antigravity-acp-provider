import { describe, expect, it } from "vitest";

import {
	decodeSessionState,
	findSessionSelector,
	selectorValues,
	sessionModels,
	sessionModes,
	splitSessionModelId,
	type AcpModelInfo,
	type SessionState,
} from "../src/acp/session-state.js";

function splitState(id = "thinking_level") {
	return decodeSessionState({ configOptions: [
		{ id: "model", name: "Model", type: "select", currentValue: "gemini-a", options: [{ value: "gemini-a", name: "Gemini A" }] },
		{ id, name: "Thinking", ...(id === "custom-thinking" ? { category: "thought_level" } : {}), type: "select", currentValue: "high",
			options: [{ group: "levels", name: "Levels", options: ["off", "low", "medium", "high"].map((value) => ({ value, name: value })) }] },
	] });
}

const modelSelector = {
	id: "model", name: "Model", type: "select", currentValue: "modern",
	options: [{ value: "modern", name: "Modern" }],
};

// ACP 1.5.2, minimized: `models.availableModels` lists each model's exact IDs,
// while the thought selector offers only the current model's levels.
const neonLevels = ["low", "medium", "high", "xhigh"];
const threeLevels = ["low", "medium", "high"];
const perModel: Record<string, string[]> = {
	"gemini-4-neon": neonLevels, "gemini-4-carbon": threeLevels, "gemini-3.8-flash": threeLevels,
};
const listed = (table: Record<string, string[]>) => Object.entries(table).flatMap(([base, levels]) =>
	levels.map((level) => ({ modelId: `${base}-${level}`, name: `Server ${base} (${level})` })));
const crossProduct = (bases: string[], levels: string[]) => bases.flatMap((base) =>
	levels.map((level) => ({ modelId: `${base}-${level}`, name: `${base} (${level})` })));

/** A `model` selector over `bases` with `current` selected, a `thought_level`
 * selector over `levels` unless absent, and the server's `models` list. */
function selectSession({ bases, current, levels, list }: {
	bases: string[]; current: string; levels?: string[]; list?: AcpModelInfo[];
}) {
	return decodeSessionState({
		...(list ? { models: { currentModelId: "stale", availableModels: list } } : {}),
		configOptions: [
			{ id: "model", name: "Model", category: "model", type: "select", currentValue: current,
				options: bases.map((value) => ({ value, name: value })) },
			...(levels ? [{ id: "thinking_level", name: "Thinking", category: "thought_level", type: "select", currentValue: "high",
				options: levels.map((value) => ({ value, name: value })) }] : []),
		],
	});
}
const ids = (state: SessionState) => sessionModels(state)?.availableModels.map((model) => model.modelId);

describe("ACP session compatibility", () => {
	it("prefers stable config options over legacy fields, including selectors without categories", () => {
		const state = decodeSessionState({
			models: { currentModelId: "legacy", availableModels: [{ modelId: "legacy", name: "Legacy" }] },
			configOptions: [modelSelector, { id: "mode", name: "Mode", type: "select", currentValue: "default", options: [{ value: "default", name: "Default" }] }],
		});
		expect(sessionModels(state)).toEqual({ currentModelId: "modern", availableModels: [{ modelId: "modern", name: "Modern" }] });
		expect(sessionModes(state)?.currentModeId).toBe("default");
	});

	it("retains valid legacy metadata and tolerates absent optional state", () => {
		const models = { currentModelId: "old", availableModels: [{ modelId: "old", name: "Old" }] };
		expect(sessionModels(decodeSessionState({ models }))).toEqual(models);
		expect(sessionModels(decodeSessionState({}))).toBeUndefined();
	});

	it("synthesizes effort-qualified models when model and thought_level selectors are split", () => {
		const state = decodeSessionState({
			configOptions: [
				{
					id: "model",
					name: "Model",
					category: "model",
					type: "select",
					currentValue: "gemini-3.8-flash",
					options: [{ value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }],
				},
				{
					id: "thinking_level",
					name: "Thinking Level",
					category: "thought_level",
					type: "select",
					currentValue: "medium",
					options: [
						{ value: "low", name: "Low" },
						{ value: "medium", name: "Medium" },
						{ value: "high", name: "High" },
					],
				},
			],
		});
		expect(sessionModels(state)).toEqual({
			currentModelId: "gemini-3.8-flash-medium",
			availableModels: [
				{ modelId: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
				{ modelId: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
				{ modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
			],
		});
	});

	it.each([
		{
			label: "base-only legacy models",
			models: {
				currentModelId: "gemini-3.8-flash",
				availableModels: [{ modelId: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }],
			},
		},
		{
			label: "stale legacy models",
			models: {
				currentModelId: "gemini-3.7-flash-low",
				availableModels: [{ modelId: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)" }],
			},
		},
	])("ignores $label when split model and thought_level selectors are present", ({ models }) => {
		const state = decodeSessionState({
			models,
			configOptions: [
				{
					id: "model",
					name: "Model",
					category: "model",
					type: "select",
					currentValue: "gemini-3.8-flash",
					options: [{ value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }],
				},
				{
					id: "thinking_level",
					name: "Thinking Level",
					category: "thought_level",
					type: "select",
					currentValue: "medium",
					options: [
						{ value: "low", name: "Low" },
						{ value: "medium", name: "Medium" },
						{ value: "high", name: "High" },
					],
				},
			],
		});
		expect(sessionModels(state)).toEqual({
			currentModelId: "gemini-3.8-flash-medium",
			availableModels: [
				{ modelId: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
				{ modelId: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)" },
				{ modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
			],
		});
	});

	it.each(["thinking_level", "thought_level", "custom-thinking"])("uses one lookup for discovery and selection (%s)", (id) => {
		const state = splitState(id);
		expect(findSessionSelector(state, "thought_level")?.id).toBe(id);
		expect(sessionModels(state)?.currentModelId).toBe("gemini-a-high");
		for (const model of sessionModels(state)!.availableModels) {
			expect(splitSessionModelId(state, model.modelId)).toEqual({ base: "gemini-a", effort: model.modelId.slice("gemini-a-".length) });
		}
		expect(splitSessionModelId(state, "gemini-a-off")).toEqual({ base: "gemini-a", effort: "off" });
		expect(splitSessionModelId(state, "gemini-a-unknown")).toBeUndefined();
	});

	it("rejects duplicate legacy IDs even when the list length matches the live inventory", () => {
		const state = splitState();
		state.models = { currentModelId: "gemini-a-high", availableModels: Array.from({ length: 4 }, () => ({ modelId: "gemini-a-high", name: "Gemini A (High)" })) };
		expect(sessionModels(state)?.availableModels.map((model) => model.modelId)).toEqual(["gemini-a-off", "gemini-a-low", "gemini-a-medium", "gemini-a-high"]);
	});

	it("retains legacy labels only for a complete compatible inventory", () => {
		const state = splitState();
		const legacy = sessionModels(state)!.availableModels.map((model) => ({ ...model, name: `Legacy ${model.name}` })).reverse();
		state.models = { currentModelId: "stale", availableModels: legacy };
		expect(sessionModels(state)?.availableModels).toEqual(legacy);
		expect(sessionModels(state)?.currentModelId).toBe("gemini-a-high");
	});

	it("preserves native qualified IDs and gives exact IDs precedence over splitting", () => {
		const state = splitState();
		const selector = findSessionSelector(state, "model")!;
		selector.options = [{ value: "gemini-a", name: "Gemini A" }, { value: "gemini-a-off", name: "Native Off" }];
		selector.currentValue = "gemini-a-off";
		expect(sessionModels(state)?.currentModelId).toBe("gemini-a-off");
		expect(sessionModels(state)?.availableModels.some((model) => model.modelId === "gemini-a-off-high")).toBe(false);
		expect(splitSessionModelId(state, "gemini-a-off")).toBeUndefined();
	});

	it.each([
		null,
		{ models: { currentModelId: "bad", availableModels: [{ modelId: 123, name: "Bad" }] } },
		{ configOptions: [{ ...modelSelector, currentValue: false }] },
		{ configOptions: [{ ...modelSelector, options: [{ value: 123, name: "Bad" }] }] },
	])("rejects malformed session state without leaking server data: %j", (state) => {
		expect(() => decodeSessionState(state)).toThrow("Invalid ACP session configuration");
	});
});

describe("per-model inventories", () => {
	const bases = Object.keys(perModel);
	const flashDefault = (list: AcpModelInfo[] = listed(perModel)) =>
		selectSession({ bases, current: "gemini-3.8-flash", levels: threeLevels, list });
	const without = (...dropped: string[]) => listed(perModel).filter((model) => !dropped.includes(model.modelId));
	// ACP 1.5.18, minimized: Neon is current with four levels, and the selector
	// also lists a thought-less model and one whose ID already carries a level.
	const bases1518 = [...bases, "claude-opus-5-5", "gemini-pro-orchestrator", "gpt-oss-120b-medium"];
	const list1518: AcpModelInfo[] = [
		...listed({ ...perModel, "claude-opus-5-5": threeLevels }),
		{ modelId: "gemini-pro-orchestrator", name: "Server Orchestrator" },
		{ modelId: "gpt-oss-120b-medium", name: "Server GPT-OSS 120B (Medium)" },
	];

	it("publishes the server's list, including Neon XHigh, when the thought selector describes the current model only", () => {
		const state = flashDefault();
		expect(sessionModels(state)).toEqual({ currentModelId: "gemini-3.8-flash-high", availableModels: listed(perModel) });
	});

	it("takes the list's word for a model that is not current, which one snapshot cannot check", () => {
		const state = flashDefault(without("gemini-4-neon-xhigh"));
		expect(sessionModels(state)?.availableModels).toEqual(without("gemini-4-neon-xhigh"));
	});

	it("keeps exact native IDs and invents no tier when the current model offers four levels", () => {
		const state = selectSession({ bases: bases1518, current: "gemini-4-neon", levels: neonLevels, list: list1518 });
		expect(sessionModels(state)).toEqual({ currentModelId: "gemini-4-neon-high", availableModels: list1518 });
		for (const invented of ["gemini-4-carbon-xhigh", "gemini-3.8-flash-xhigh", "claude-opus-5-5-xhigh", "gemini-pro-orchestrator-xhigh"]) {
			expect(ids(state)).not.toContain(invented);
		}
		expect(splitSessionModelId(state, "gemini-pro-orchestrator")).toBeUndefined();
		expect(splitSessionModelId(state, "gpt-oss-120b-medium")).toBeUndefined();
	});

	it("keeps the list when the current model has no thought selector", () => {
		const state = selectSession({ bases: bases1518, current: "gemini-pro-orchestrator", list: list1518 });
		expect(sessionModels(state)).toEqual({ currentModelId: "gemini-pro-orchestrator", availableModels: list1518 });
	});

	it("leaves qualified IDs to the legacy selection method when no thought selector exists", () => {
		const state = selectSession({ bases: bases1518, current: "gemini-pro-orchestrator", list: list1518 });
		expect(splitSessionModelId(state, "gemini-4-neon-xhigh")).toBeUndefined();
	});

	it("accepts a non-current model level named by the live thought selector", () => {
		const table = { "gemini-4-neon": [...neonLevels, "ultra"], "gemini-3.8-flash": ["low", "medium", "ultra"] };
		const state = selectSession({ bases: Object.keys(table), current: "gemini-3.8-flash", levels: table["gemini-3.8-flash"], list: listed(table) });
		expect(sessionModels(state)).toEqual({ currentModelId: "gemini-3.8-flash-high", availableModels: listed(table) });
		expect(splitSessionModelId(state, "gemini-4-neon-ultra")).toEqual({ base: "gemini-4-neon", effort: "ultra" });
	});

	it.each([
		{ label: "an empty list", list: [] },
		{ label: "base IDs only", list: bases.map((modelId) => ({ modelId, name: modelId })) },
		{ label: "a model the selector no longer offers", list: [...listed(perModel), { modelId: "gemini-4-hydrogen-high", name: "Gemini 4 Hydrogen (High)" }] },
		{ label: "an unknown suffix on a known base", list: [...listed(perModel), { modelId: "gemini-4-neon-pro", name: "Gemini 4 Neon Pro" }] },
		{ label: "a compound unknown suffix on a known base", list: [...listed(perModel), { modelId: "gemini-4-neon-pro-high", name: "Gemini 4 Neon Pro High" }] },
		{ label: "a selector model missing from the list", list: without("gemini-4-carbon-low", "gemini-4-carbon-medium", "gemini-4-carbon-high") },
		{ label: "a repeated ID", list: [...listed(perModel), { modelId: "gemini-4-neon-xhigh", name: "Gemini 4 Neon (XHigh)" }] },
		{ label: "the current model missing a level", list: without("gemini-3.8-flash-medium") },
		{ label: "the current model with a level the selector lacks", list: [...listed(perModel), { modelId: "gemini-3.8-flash-xhigh", name: "Server gemini-3.8-flash (xhigh)" }] },
		{ label: "a bare model beside its variants", list: [{ modelId: "gemini-4-neon", name: "Server gemini-4-neon" }, ...listed(perModel)] },
	])("falls back to the selectors for $label", ({ list }) => {
		const state = flashDefault(list);
		expect(sessionModels(state)).toEqual({ currentModelId: "gemini-3.8-flash-high", availableModels: crossProduct(bases, threeLevels) });
		expect(splitSessionModelId(state, "gemini-4-neon-xhigh")).toBeUndefined();
	});

	it("validates the current model's levels against the base its selector value names when the server echoes a qualified value", () => {
		const echoed = selectSession({ bases, current: "gemini-4-neon-xhigh", levels: neonLevels, list: listed(perModel) });
		expect(sessionModels(echoed)).toEqual({ currentModelId: "gemini-4-neon-xhigh", availableModels: listed(perModel) });
		const incomplete = selectSession({ bases, current: "gemini-3.8-flash-high", levels: threeLevels, list: without("gemini-3.8-flash-low") });
		expect(sessionModels(incomplete)?.availableModels).toEqual(crossProduct(bases, threeLevels));
	});

	it("keeps a selector value that already names a whole ID whole, beside split variants", () => {
		const native: AcpModelInfo = { modelId: "gpt-oss-120b-medium", name: "Server GPT-OSS 120B (Medium)" };
		const selectors = { bases: ["gemini-4-neon", native.modelId], current: "gemini-4-neon", levels: neonLevels };
		const mixed = selectSession({ ...selectors, list: [...listed({ "gemini-4-neon": neonLevels }), native] });
		expect(sessionModels(mixed)).toEqual({ currentModelId: "gemini-4-neon-high", availableModels: [...listed({ "gemini-4-neon": neonLevels }), native] });
		expect(splitSessionModelId(mixed, native.modelId)).toBeUndefined();
		// Only a base without a level supplies variants.
		const varied = selectSession({ ...selectors, list: [...listed({ "gemini-4-neon": neonLevels }), native,
			{ modelId: "gpt-oss-120b-medium-xhigh", name: "Server GPT-OSS 120B (Medium XHigh)" }] });
		expect(sessionModels(varied)?.availableModels)
			.toEqual([...crossProduct(["gemini-4-neon"], neonLevels), { modelId: native.modelId, name: native.modelId }]);
		expect(splitSessionModelId(varied, "gpt-oss-120b-medium-xhigh")).toBeUndefined();
	});

	it("does not split a selector value that ends in a live thought level", () => {
		const state = splitState();
		findSessionSelector(state, "model")!.options = [{ value: "gemini-a", name: "Gemini A" }, { value: "gemini-a-off", name: "Native Off" }];
		expect(splitSessionModelId(state, "gemini-a-off-high")).toBeUndefined();
	});

	it("offers each discovered ID through one route only, and no other ID", () => {
		const state = selectSession({ bases: bases1518, current: "gemini-4-neon", levels: neonLevels, list: list1518 });
		const whole = selectorValues(findSessionSelector(state, "model")!).map((option) => option.value);
		for (const { modelId } of sessionModels(state)!.availableModels) {
			expect(splitSessionModelId(state, modelId) !== undefined, modelId).toBe(!whole.includes(modelId));
		}
		expect(splitSessionModelId(state, "gemini-4-neon-xhigh")).toEqual({ base: "gemini-4-neon", effort: "xhigh" });
		expect(splitSessionModelId(state, "claude-opus-5-5-low")).toEqual({ base: "claude-opus-5-5", effort: "low" });
		expect(splitSessionModelId(state, "gemini-4-carbon-xhigh")).toBeUndefined();
	});
});
