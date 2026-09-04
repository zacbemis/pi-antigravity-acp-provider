import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AcpSessionStore } from "../src/acp/session-store.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("AcpSessionStore", () => {
	it("persists, replaces, and removes Pi-to-ACP bindings", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-sessions-"));
		roots.push(root);
		const file = path.join(root, "sessions.json");
		const store = new AcpSessionStore(file);
		store.save({
			piSessionId: "pi-1",
			acpSessionId: "acp-1",
			acpModelId: "gemini-low",
			cwd: "/tmp/project",
			messageCount: 2,
			historyFingerprint: "abc",
			lastActive: Date.now(),
		});
		expect(new AcpSessionStore(file).get("pi-1")?.acpSessionId).toBe("acp-1");
		store.save({ ...store.get("pi-1")!, acpSessionId: "acp-2", lastActive: Date.now() });
		expect(store.get("pi-1")?.acpSessionId).toBe("acp-2");
		store.remove("pi-1");
		expect(store.get("pi-1")).toBeUndefined();
	});

	it("ignores malformed records", () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-sessions-"));
		roots.push(root);
		const file = path.join(root, "sessions.json");
		fs.writeFileSync(file, '[{"piSessionId":"bad"}]');
		expect(new AcpSessionStore(file).get("bad")).toBeUndefined();
	});
});
