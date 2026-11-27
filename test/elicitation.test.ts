import { describe, expect, it, vi } from "vitest";

import { answerQuestionForm } from "../extensions/elicitation.js";
import { elicitationForm, elicitationResult, type QuestionForm } from "../src/acp/elicitation.js";
import { PiMcpBridge } from "../src/mcp/bridge.js";
import { QUESTION_TOOL_NAME } from "../src/constants.js";
import { Type } from "typebox";

const form: QuestionForm = {
	message: "Pick a color",
	schema: { type: "object", properties: { color: { type: "string", oneOf: [{ const: "r", title: "Red" }, { const: "b", title: "Blue" }] } }, required: ["color"] },
};
const ui = () => ({ select: vi.fn(), input: vi.fn(), notify: vi.fn() });

describe("native question forms", () => {
	it("returns the option's wire value, not its display label", async () => {
		const view = ui();
		view.select.mockResolvedValueOnce("2. Blue").mockResolvedValueOnce("Submit answers");
		const result = await answerQuestionForm(form, view);
		expect(result).toEqual({ action: "accept", content: { color: "b" } });
		expect(elicitationResult(form, { content: [{ type: "text", text: JSON.stringify(result) }] })).toEqual(result);
	});

	it("supports multiple selections, write-ins, numeric validation, and booleans", async () => {
		const view = ui();
		view.select.mockResolvedValueOnce("[ ] 1. Red").mockResolvedValueOnce("[ ] 2. Blue")
			.mockResolvedValueOnce("Done").mockResolvedValueOnce("2. No").mockResolvedValueOnce("Submit answers");
		view.input.mockResolvedValueOnce("Custom answer").mockResolvedValueOnce("0").mockResolvedValueOnce("3");
		const response = await answerQuestionForm({ message: "Questions", schema: {
			type: "object", properties: {
				colors: { type: "array", items: { anyOf: [{ const: "r", title: "Red" }, { const: "b", title: "Blue" }] }, minItems: 1 },
				other: { type: "string" }, count: { type: "integer", minimum: 1 }, enabled: { type: "boolean" },
			}, required: ["colors", "other", "count", "enabled"],
		} }, view);
		expect(response).toEqual({ action: "accept", content: { colors: ["r", "b"], other: "Custom answer", count: 3, enabled: false } });
		expect(view.notify).toHaveBeenCalledOnce();
	});

	it("allows editing before submitting", async () => {
		const view = ui();
		view.select.mockResolvedValueOnce("1. Red").mockResolvedValueOnce("Edit answers")
			.mockResolvedValueOnce("2. Blue").mockResolvedValueOnce("Submit answers");
		expect(await answerQuestionForm(form, view)).toEqual({ action: "accept", content: { color: "b" } });
	});

	it("cancels on dismissal, abort, unavailable UI, or unsupported fields", async () => {
		const view = ui();
		view.select.mockResolvedValue(undefined);
		expect(await answerQuestionForm(form, view)).toEqual({ action: "cancel" });
		const controller = new AbortController();
		controller.abort();
		expect(await answerQuestionForm(form, view, controller.signal)).toEqual({ action: "cancel" });
		view.select.mockRejectedValue(new Error("No UI"));
		expect(await answerQuestionForm(form, view)).toEqual({ action: "cancel" });
		expect(await answerQuestionForm({ message: "Unknown", schema: { properties: { field: { type: "object" } } } }, view)).toEqual({ action: "cancel" });
	});

	it.each(["{}", "not json", '{"action":"accept","content":{"color":"invalid"}}', '{"action":"accept","content":{}}'])("cancels malformed answers: %s", (text) => {
		expect(elicitationResult(form, { content: [{ type: "text", text }] })).toEqual({ action: "cancel" });
	});

	it("cancels failed tools and preserves explicit decline", () => {
		expect(elicitationResult(form, { content: [], isError: true })).toEqual({ action: "cancel" });
		expect(elicitationResult(form, { content: [{ type: "text", text: '{"action":"decline"}' }] })).toEqual({ action: "decline" });
		expect(elicitationForm({ mode: "url", sessionId: "s", message: "Open", elicitationId: "e", url: "https://example.com" })).toBeUndefined();
	});

	it("never advertises its internal question tool through MCP", () => {
		const bridge = new PiMcpBridge({ tools: [{ name: QUESTION_TOOL_NAME, description: "Internal", parameters: Type.Object({ requestId: Type.String() }) }], onCall: async () => ({ content: [] }) });
		expect(bridge.empty).toBe(true);
	});
});
