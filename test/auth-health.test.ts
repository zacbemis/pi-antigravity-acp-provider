import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	clearAntigravityCredentials,
	inspectAntigravityAuth,
} from "../src/acp/antigravity.js";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function root(): string {
	const value = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-auth-"));
	roots.push(value);
	return value;
}

describe("Antigravity auth health", () => {
	it("does not mistake settings alone for completed authentication", () => {
		const directory = root();
		fs.writeFileSync(path.join(directory, "settings.json"), '{"auth":{"type":"oauth-personal"}}');
		expect(inspectAntigravityAuth(directory).status).toBe("configured-not-authenticated");
	});

	it("recognizes a structurally refreshable token and clears it", () => {
		const directory = root();
		fs.writeFileSync(path.join(directory, "settings.json"), '{"auth":{"type":"oauth-personal"}}');
		fs.writeFileSync(path.join(directory, "acp_token.json"), '{"refresh_token":"secret"}');
		expect(inspectAntigravityAuth(directory).status).toBe("oauth-refreshable");
		clearAntigravityCredentials(directory);
		expect(inspectAntigravityAuth(directory).status).toBe("missing");
	});

	it("reports corrupt token files", () => {
		const directory = root();
		fs.writeFileSync(path.join(directory, "acp_token.json"), "not-json");
		expect(inspectAntigravityAuth(directory).status).toBe("corrupt");
	});
});
