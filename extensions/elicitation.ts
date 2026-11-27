import type { CreateElicitationResponse, ElicitationContentValue } from "@agentclientprotocol/sdk/unstable";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";

import type { QuestionForm } from "../src/acp/elicitation.js";

type Field = Record<string, unknown>;
type QuestionUi = Pick<ExtensionContext["ui"], "select" | "input" | "notify">;

export async function answerQuestionForm(
	form: QuestionForm,
	ui: QuestionUi,
	signal?: AbortSignal,
): Promise<CreateElicitationResponse> {
	const options = signal ? { signal } : undefined;
	try {
		for (;;) {
			const content: Record<string, ElicitationContentValue> = Object.create(null);
			for (const [name, schema] of Object.entries(form.schema.properties ?? {})) {
				if (signal?.aborted) return { action: "cancel" };
				const field = schema as Field;
				const title = `Antigravity: ${String(field.title ?? name)}${field.description ? `\n${field.description}` : ""}`;
				const required = form.schema.required?.includes(name) === true;
				let value: ElicitationContentValue | undefined;
				for (;;) {
					const choices = fieldChoices(field);
					if (choices) {
						const labels = choices.map((choice, index) => `${index + 1}. ${choice.label}`);
						if (!required) labels.push("Skip");
						const selected = await ui.select(title, labels, options);
						if (selected === undefined) return { action: "cancel" };
						value = choices[labels.indexOf(selected)]?.value;
					} else if (field.type === "array") {
						const items = field.items as Field | undefined;
						const choices = items && fieldChoices(items);
						if (!choices) return { action: "cancel" };
						const picked = new Set<number>();
						for (;;) {
							const labels = choices.map((choice, index) => `${picked.has(index) ? "[x]" : "[ ]"} ${index + 1}. ${choice.label}`);
							labels.push("Done");
							const selected = await ui.select(title, labels, options);
							if (selected === undefined) return { action: "cancel" };
							const index = labels.indexOf(selected);
							if (index === choices.length) break;
							if (index < 0) return { action: "cancel" };
							if (picked.has(index)) picked.delete(index);
							else picked.add(index);
						}
						value = [...picked].sort((a, b) => a - b).map((index) => String(choices[index]!.value));
					} else if (["string", "number", "integer"].includes(String(field.type))) {
						const answer = await ui.input(title, required ? "Enter an answer" : "Optional; leave empty to skip", options);
						if (answer === undefined) return { action: "cancel" };
						value = !required && answer === "" ? undefined
							: field.type === "string" ? answer : answer.trim() === "" ? NaN : Number(answer);
					} else return { action: "cancel" };
					if (signal?.aborted) return { action: "cancel" };
					if (value === undefined && !required) break;
					if (Value.Check(field, value)) break;
					ui.notify("The answer does not match the requested format. Please try again.", "warning");
				}
				if (value !== undefined) content[name] = value;
			}
			const summary = Object.entries(content).map(([name, value]) => `${form.schema.properties?.[name]?.title ?? name}: ${JSON.stringify(value)}`).join("\n");
			const selected = await ui.select(`Antigravity: ${form.message}\n\n${summary}`, ["Submit answers", "Edit answers", "Cancel"], options);
			if (signal?.aborted || selected === undefined || selected === "Cancel") return { action: "cancel" };
			if (selected === "Submit answers") return { action: "accept", content };
		}
	} catch {
		// Headless or disconnected UIs must not leave the agent waiting for input.
		return { action: "cancel" };
	}
}

function fieldChoices(field: Field): Array<{ value: string | boolean; label: string }> | undefined {
	if (field.type === "boolean") return [{ value: true, label: "Yes" }, { value: false, label: "No" }];
	if (Array.isArray(field.enum) && field.enum.every((value) => typeof value === "string")) {
		return field.enum.map((value) => ({ value, label: value }));
	}
	const variants = field.oneOf ?? field.anyOf;
	if (!Array.isArray(variants) || !variants.every((item) => item && typeof item.const === "string")) return undefined;
	return variants.map((item: Field) => ({ value: String(item.const), label: String(item.title ?? item.const) }));
}
