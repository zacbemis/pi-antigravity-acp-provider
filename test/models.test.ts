import { describe, expect, it } from "vitest";

import { projectModels } from "../src/models.js";
import { createGeminiProvider } from "../src/provider.js";

describe("projectModels", () => {
	it("deduplicates and rejects unsafe ids", () => {
		const models = projectModels([
			{ modelId: "gemini-a", name: "Gemini A" },
			{ modelId: "gemini-a", name: "duplicate" },
			{ modelId: "bad\nmodel", name: "bad" },
		]);
		expect(models.map((model) => model.id)).toEqual(["gemini-a"]);
		expect(models[0]?.cost.input).toBe(0);
	});

	it("registers separate Google-account and API-key login methods", async () => {
		const { provider, runtime } = createGeminiProvider();
		try {
			expect(provider.auth.oauth?.loginLabel).toBe("Sign in with Google");
			expect(provider.auth.apiKey?.name).toBe("Antigravity Gemini API key");
		} finally {
			await runtime.close();
		}
	});
});
