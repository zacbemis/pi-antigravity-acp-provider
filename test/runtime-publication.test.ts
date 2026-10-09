import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const script = fileURLToPath(new URL("../scripts/publish-runtime-manifest.mjs", import.meta.url));
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

function publication(env: Record<string, string> = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-publication-test-"));
	roots.push(root);
	const log = path.join(root, "calls.jsonl");
	fs.writeFileSync(log, "");
	const stub = `#!${process.execPath}
import fs from "node:fs";
import path from "node:path";
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALL_LOG, JSON.stringify({command, args}) + "\\n");
const head = "a".repeat(40);
const output = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v));
if (command === "git") {
  if (args.includes("--quiet")) process.exit(process.env.NO_CHANGE === "true" ? 0 : 1);
  if (args.includes("--name-only")) output(process.env.OTHER_CHANGE === "true" ? "runtime-manifest.json\\nsrc/runtime.ts" : "runtime-manifest.json");
} else if (args[0] === "pr" && args[1] === "create") output("https://github.com/zacbemis/pi-antigravity-acp-provider/pull/99");
else if (args[0] === "pr" && args[1] === "view") output({ headRefOid: process.env.CHANGED_HEAD === "true" && args.includes("headRefOid,mergeStateStatus") ? "b".repeat(40) : head, mergeStateStatus: "CLEAN" });
else if (args[0] === "run" && args[1] === "list") output([{databaseId: 123, headSha: head}]);
else if (args[0] === "run" && args[1] === "watch") process.exit(process.env.CI_FAIL === "true" ? 1 : 0);
else if (args[0] === "run" && args[1] === "view") output({ conclusion: "success", headSha: head,
  jobs: process.env.MISSING_JOB === "true" ? [] : ["Check (22.19.0)", "Check (24)"].map(name => ({name, conclusion: "success"})) });
else if (!((args[0] === "workflow" && args[1] === "run") || (args[0] === "pr" && ["merge", "close", "update-branch"].includes(args[1])))) process.exit(2);
`;
	for (const name of ["git", "gh"]) {
		fs.writeFileSync(path.join(root, name), stub, { mode: 0o755 });
	}
	// The stubs are ESM even though their executable filenames have no extension.
	fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}');
	const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8", env: {
		...process.env, PATH: `${root}${path.delimiter}${process.env.PATH}`, CALL_LOG: log,
		GITHUB_REPOSITORY: "zacbemis/pi-antigravity-acp-provider", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
		GH_TOKEN: "test-only-not-a-credential", ...env,
	} });
	const calls = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean)
		.map((line) => JSON.parse(line) as { command: string; args: string[] });
	return { result, calls };
}

// The publication workflow runs on Ubuntu; executable command stubs are POSIX.
describe.skipIf(process.platform === "win32")("protected runtime publication", () => {
	it("does nothing when the signed manifest is current", () => {
		const { result, calls } = publication({ NO_CHANGE: "true" });
		expect(result.status).toBe(0);
		expect(calls.some((call) => call.command === "gh")).toBe(false);
	});

	it("rejects changes outside the signed manifest before committing or pushing", () => {
		const { result, calls } = publication({ OTHER_CHANGE: "true" });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("outside runtime-manifest.json");
		expect(calls.some((call) => call.args[0] === "push")).toBe(false);
	});

	it("dispatches real CI and merges only the checked PR head", () => {
		const { result, calls } = publication();
		expect(result.status, result.stderr).toBe(0);
		const dispatch = calls.findIndex((call) => call.args[0] === "workflow");
		const watch = calls.findIndex((call) => call.args[1] === "watch");
		const merge = calls.findIndex((call) => call.args[1] === "merge");
		expect(dispatch).toBeGreaterThan(-1);
		expect(watch).toBeGreaterThan(dispatch);
		expect(merge).toBeGreaterThan(watch);
		expect(calls[merge]?.args).toContain("--match-head-commit");
		expect(calls[merge]?.args).toContain("a".repeat(40));
		expect(calls.find((call) => call.command === "git" && call.args[0] === "push")?.args).toEqual(["push", "origin", "automation/runtime-manifest-123-1"]);
	});

	it("closes publication-check PRs without changing main", () => {
		const { result, calls } = publication({ RUNTIME_PUBLICATION_TEST: "true" });
		expect(result.status, result.stderr).toBe(0);
		expect(calls.some((call) => call.args[1] === "close")).toBe(true);
		expect(calls.some((call) => call.args[1] === "merge")).toBe(false);
	});

	it("can verify the full protected merge path using a signed whitespace-only catalog", () => {
		const { result, calls } = publication({ RUNTIME_PUBLICATION_TEST: "true", RUNTIME_PUBLICATION_TEST_MERGE: "true" });
		expect(result.status, result.stderr).toBe(0);
		expect(calls.some((call) => call.args[1] === "merge")).toBe(true);
		expect(calls.some((call) => call.args[1] === "close")).toBe(false);
	});

	it.each([{ CI_FAIL: "true" }, { MISSING_JOB: "true" }, { CHANGED_HEAD: "true" }])("never merges failed/missing/stale checks: %j", (env) => {
		const { result, calls } = publication(env);
		expect(result.status).not.toBe(0);
		expect(calls.some((call) => call.args[1] === "merge")).toBe(false);
	});
});
