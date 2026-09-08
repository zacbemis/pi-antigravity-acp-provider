import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { AntigravityProcess, resolveSupervisorEntry } from "../src/acp/process.js";

const parentFixture = fileURLToPath(new URL("./fixtures/watchdog-parent.mjs", import.meta.url));
const agentFixture = fileURLToPath(new URL("./fixtures/long-agent.mjs", import.meta.url));
const ignoreTermFixture = fileURLToPath(new URL("./fixtures/ignore-term.mjs", import.meta.url));
const exitAgentFixture = fileURLToPath(new URL("./fixtures/exit-agent.mjs", import.meta.url));
const cleanupPids = new Set<number>();

afterEach(() => {
	for (const pid of cleanupPids) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
	cleanupPids.clear();
});

describe.skipIf(process.platform === "win32")("parent-death supervisor", () => {
	it("escalates from TERM to KILL for a stuck direct child", async () => {
		const child = new AntigravityProcess({
			cwd: process.cwd(),
			command: process.execPath,
			args: [ignoreTermFixture],
		});
		await new Promise<void>((resolve) => child.child.stdout.once("data", () => resolve()));
		const started = Date.now();
		const closing = child.close();
		await delay(25);
		expect(child.child.stdin.writableEnded).toBe(false);
		await closing;
		expect(Date.now() - started).toBeGreaterThanOrEqual(1_400);
		expect(child.alive).toBe(false);
	});

	it("exits promptly when the supervised agent exits", async () => {
		const child = new AntigravityProcess({ cwd: process.cwd(), entryPath: exitAgentFixture, args: [] });
		const exit = await Promise.race([
			child.exited,
			delay(2_000).then(() => {
				throw new Error("supervisor stayed alive after agent exit");
			}),
		]);
		expect(exit.code).toBe(3);
		expect(child.alive).toBe(false);
	});

	it("kills the Gemini process group after an abrupt parent death", async () => {
		const directory = await fs.mkdtemp(path.join(os.tmpdir(), "antigravity-acp-watchdog-"));
		const pidFile = path.join(directory, "pids.json");
		const parent = spawn(process.execPath, [parentFixture, resolveSupervisorEntry(), agentFixture, pidFile], {
			stdio: ["ignore", "pipe", "inherit"],
		});
		if (!parent.pid) throw new Error("parent fixture did not start");
		cleanupPids.add(parent.pid);
		const lines = readline.createInterface({ input: parent.stdout, crlfDelay: Infinity });
		const first = await Promise.race([
			new Promise<string>((resolve) => lines.once("line", resolve)),
			delay(6_000).then(() => {
				throw new Error("watchdog fixture timed out");
			}),
		]);
		const pids = JSON.parse(first) as { supervisor: number; agent: number; grandchild: number };
		for (const pid of Object.values(pids)) cleanupPids.add(pid);

		process.kill(parent.pid, "SIGKILL");
		cleanupPids.delete(parent.pid);
		await waitUntilGone([pids.supervisor, pids.agent, pids.grandchild], 4_000);
		for (const pid of Object.values(pids)) {
			expect(isAlive(pid), `pid ${pid} should be gone`).toBe(false);
			cleanupPids.delete(pid);
		}
		await fs.rm(directory, { recursive: true, force: true });
	}, 10_000);
});

async function waitUntilGone(pids: number[], timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (pids.some(isAlive) && Date.now() < deadline) await delay(50);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
