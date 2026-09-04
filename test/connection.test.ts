import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AntigravityAcpConnection } from "../src/acp/connection.js";

const fakeAgent = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));

describe("AntigravityAcpConnection", () => {
	it("uses the official SDK against a real child process", async () => {
		const updates: string[] = [];
		const connection = new AntigravityAcpConnection({
			cwd: path.dirname(fakeAgent),
			command: process.execPath,
			args: [fakeAgent],
			handlers: {
				onUpdate: (notification) => {
					updates.push(notification.update.sessionUpdate);
				},
			},
		});
		try {
			const initialize = await connection.initialize();
			expect(initialize.agentInfo?.name).toBe("fake-gemini");
			await connection.authenticate({ methodId: "api", _meta: { "api-key": "secret" } });
			const session = await connection.newSession(process.cwd());
			expect(session.models?.availableModels).toHaveLength(2);
			await connection.setModel(session.sessionId, "gemini-test");
			const response = await connection.prompt({
				sessionId: session.sessionId,
				prompt: [{ type: "text", text: "hello" }],
			});
			expect(response.stopReason).toBe("end_turn");
			expect(updates).toEqual(["agent_thought_chunk", "agent_message_chunk"]);
		} finally {
			await connection.close();
		}
		expect(connection.process.alive).toBe(false);
	});
});
