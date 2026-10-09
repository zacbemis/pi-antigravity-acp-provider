import { describe, expect, it } from "vitest";

import { decodeSessionState, sessionModels, sessionModes } from "../src/acp/session-state.js";

const modelSelector = {
	id: "model", name: "Model", type: "select", currentValue: "modern",
	options: [{ value: "modern", name: "Modern" }],
};

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

	it.each([
		null,
		{ models: { currentModelId: "bad", availableModels: [{ modelId: 123, name: "Bad" }] } },
		{ configOptions: [{ ...modelSelector, currentValue: false }] },
		{ configOptions: [{ ...modelSelector, options: [{ value: 123, name: "Bad" }] }] },
	])("rejects malformed session state without leaking server data: %j", (state) => {
		expect(() => decodeSessionState(state)).toThrow("Invalid ACP session configuration");
	});
});
