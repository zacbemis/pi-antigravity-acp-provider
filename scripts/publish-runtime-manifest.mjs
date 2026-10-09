import { execFileSync, spawnSync } from "node:child_process";

const repo = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
const attempt = process.env.GITHUB_RUN_ATTEMPT ?? "1";
const publicationTest = process.env.RUNTIME_PUBLICATION_TEST === "true";
const mergePublicationTest = publicationTest && process.env.RUNTIME_PUBLICATION_TEST_MERGE === "true";
if (repo !== "zacbemis/pi-antigravity-acp-provider" || !/^\d+$/u.test(runId ?? "") || !/^\d+$/u.test(attempt)) {
	throw new Error("Runtime publication requires the official repository and a valid Actions run identity");
}
if (!process.env.GH_TOKEN) throw new Error("GH_TOKEN is required for runtime publication");

const run = (command, args, timeout = 60_000) => execFileSync(command, args, {
	encoding: "utf8", timeout, stdio: ["ignore", "pipe", "inherit"],
}).trim();
const git = (...args) => run("git", args);
const gh = (...args) => run("gh", [...args, "--repo", repo]);
const json = (...args) => JSON.parse(gh(...args));
const changed = spawnSync("git", ["diff", "--quiet", "HEAD", "--", "runtime-manifest.json"]);
if (changed.status === 0) {
	console.log("The signed manifest is already current.");
	process.exit(0);
}
if (changed.status !== 1) throw new Error("Could not inspect runtime manifest changes");
const paths = git("diff", "--name-only", "HEAD").split("\n").filter(Boolean);
if (paths.length !== 1 || paths[0] !== "runtime-manifest.json") {
	throw new Error("Runtime publication refuses changes outside runtime-manifest.json");
}

const branch = `automation/runtime-manifest-${runId}-${attempt}`;
git("switch", "-c", branch);
git("config", "user.name", "github-actions[bot]");
git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
git("add", "runtime-manifest.json");
const title = publicationTest ? "test: verify protected runtime publication" : "chore: approve latest Antigravity ACP runtime";
git("commit", "-m", title);
git("push", "origin", branch);
const url = gh("pr", "create", "--base", "main", "--head", branch, "--title", title, "--body",
	publicationTest
		? `Bot publication check: this changes only whitespace in the already-signed catalog. CI will be dispatched explicitly; after both checks pass the PR will ${mergePublicationTest ? "merge through normal branch protection" : "close without merging"}. The signed payload and approved releases are unchanged.`
		: "Verified official Google artifacts and signed runtime catalog update. Explicit CI dispatch is required because GITHUB_TOKEN-created PRs do not trigger pull_request workflows. No branch-protection bypass is used.");
if (!url.startsWith(`https://github.com/${repo}/pull/`)) throw new Error("Unexpected runtime pull request URL");
console.log(url);

// A long artifact download may outlive other main updates. Refresh the PR base
// before dispatching CI; if main moves during CI, repeat with the new head.
for (let refresh = 0; refresh < 3; refresh++) {
	gh("pr", "update-branch", url);
	const { headRefOid } = json("pr", "view", url, "--json", "headRefOid");
	if (!/^[0-9a-f]{40}$/u.test(headRefOid)) throw new Error("Invalid runtime PR head");
	gh("workflow", "run", "ci.yml", "--ref", branch);
	let runId;
	for (let poll = 0; poll < 40; poll++) {
		const runs = json("run", "list", "--workflow", "ci.yml", "--branch", branch,
			"--event", "workflow_dispatch", "--limit", "5", "--json", "databaseId,headSha");
		runId = runs.find((entry) => entry.headSha === headRefOid)?.databaseId;
		if (runId) break;
		await new Promise((resolve) => setTimeout(resolve, 2_000));
	}
	if (!Number.isSafeInteger(runId)) throw new Error("Dispatched runtime CI did not appear");
	// This is real CI on the exact PR head, not fabricated commit statuses.
	run("gh", ["run", "watch", String(runId), "--exit-status", "--interval", "10", "--repo", repo], 20 * 60_000);
	const runResult = json("run", "view", String(runId), "--json", "conclusion,headSha,jobs");
	if (runResult.conclusion !== "success" || runResult.headSha !== headRefOid ||
		!["Check (22.19.0)", "Check (24)"].every((name) =>
			runResult.jobs.some((job) => job.name === name && job.conclusion === "success"))) {
		throw new Error("Both required CI jobs must pass on the exact runtime PR head");
	}
	const current = json("pr", "view", url, "--json", "headRefOid,mergeStateStatus");
	if (current.headRefOid !== headRefOid) throw new Error("Runtime PR changed during CI");
	if (current.mergeStateStatus === "BEHIND") continue;
	if (publicationTest && !mergePublicationTest) {
		gh("pr", "close", url, "--delete-branch", "--comment", "Bot PR creation and explicit CI dispatch passed on both Node versions. Publication test: main was not changed.");
	} else {
		gh("pr", "merge", url, "--squash", "--delete-branch", "--match-head-commit", headRefOid);
	}
	process.exit(0);
}
throw new Error("Main kept moving during runtime CI; the signed PR remains open for review");
