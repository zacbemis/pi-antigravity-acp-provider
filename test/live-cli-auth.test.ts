import { createModels } from "@earendil-works/pi-ai/models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { AUTH_BACKEND_ENV } from "../src/acp/auth-backend.js";
import { providerAcpDirectory } from "../src/acp/credential-storage.js";
import { createAntigravityProvider } from "../src/provider.js";
import { AntigravityRuntime } from "../src/runtime.js";

const enabled = process.env.PI_ANTIGRAVITY_ACP_CLI_LIVE === "1";

describe.skipIf(!enabled)("Antigravity CLI cached Google login", () => {
	it("validates cached login and completes a Neon High prompt without standalone credentials", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cli-live-"));
		vi.stubEnv("PI_CODING_AGENT_DIR", root);
		vi.stubEnv(AUTH_BACKEND_ENV, "cli");
		const runtime = new AntigravityRuntime(undefined, "default");
		const { provider } = createAntigravityProvider(runtime);
		const models = createModels();
		models.setProvider(provider);
		try {
			await models.login(provider.id, "oauth", { signal: AbortSignal.timeout(120_000),
				notify() {}, prompt: async () => { throw new Error("Sign in with agy acp --login before running this test"); } });
			const model = provider.getModels().find((candidate) => candidate.id === "gemini-4-neon");
			expect(model).toBeDefined();
			const response = await models.streamSimple(model!, { messages: [{ role: "user", timestamp: Date.now(),
				content: "Do not use tools or change any files. Reply with exactly: NEON_CLI_AUTH_OK" }] },
				{ sessionId: "cli-live-neon", reasoning: "high", signal: AbortSignal.timeout(120_000) }).result();
			expect(response.errorMessage).toBeUndefined();
			expect(response.stopReason).toBe("stop");
			expect(response.content.some((block) => block.type === "text" && block.text.includes("NEON_CLI_AUTH_OK"))).toBe(true);
			expect((await runtime.snapshot()).processes[0]?.modelId).toBe("gemini-4-neon-high");
			expect(fs.existsSync(path.join(providerAcpDirectory(), "acp_token.json"))).toBe(false);
		} finally {
			await runtime.close();
			vi.unstubAllEnvs();
			fs.rmSync(root, { recursive: true, force: true });
		}
	}, 180_000);
});
