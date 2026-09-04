import { describe, expect, it } from "vitest";

import { AntigravityAcpConnection } from "../src/acp/connection.js";
import { resolveAntigravityAcpEntry } from "../src/acp/process.js";

const enabled = process.env.PI_ANTIGRAVITY_ACP_REAL === "1";

describe.skipIf(!enabled)("Google Antigravity ACP contract", () => {
	it("resolves the Antigravity server and completes ACP initialize", async () => {
		const entry = resolveAntigravityAcpEntry();
		expect(entry).toMatch(/agy_acp_server\.par$/u);

		const connection = new AntigravityAcpConnection({ cwd: process.cwd(), initializeTimeoutMs: 45_000 });
		try {
			const result = await connection.initialize();
			expect(result.protocolVersion).toBe(1);
			expect(result.agentInfo?.name).toBe("antigravity-acp");
			expect(result.authMethods?.length).toBeGreaterThan(0);
			expect(result.authMethods?.some((method) => method.id === "oauth-personal")).toBe(true);
		} finally {
			await connection.close();
		}
	}, 60_000);
});
