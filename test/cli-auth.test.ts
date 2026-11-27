import { normalizeContext } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AntigravityAcpConnection } from "../src/acp/connection.js";
import { providerAcpDirectory } from "../src/acp/credential-storage.js";
import { AcpSessionStore } from "../src/acp/session-store.js";
import { ensureAntigravityAcpReady } from "../src/acp/setup.js";
import { AUTH_BACKEND_ENV, authenticationBackend } from "../src/acp/auth-backend.js";
import { newGoogleLoginMarker, savedGoogleLogin } from "../src/auth.js";
import { MANAGED_AUTH_MARKER } from "../src/constants.js";
import { FALLBACK_MODELS } from "../src/models.js";
import { createAntigravityProvider } from "../src/provider.js";
import { AntigravityRuntime } from "../src/runtime.js";

const fakeAgent = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
let root: string;
let runtimes: AntigravityRuntime[];

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cli-auth-"));
	runtimes = [];
	vi.stubEnv("PI_CODING_AGENT_DIR", root);
	vi.stubEnv(AUTH_BACKEND_ENV, "cli");
	vi.stubEnv("AGY_ACP_BIN", process.execPath);
	vi.stubEnv("GEMINI_API_KEY", "ambient-key-must-not-leak");
});

afterEach(async () => {
	await Promise.all(runtimes.map((runtime) => runtime.close()));
	vi.unstubAllEnvs();
	fs.rmSync(root, { recursive: true, force: true });
});

function setup(scenario = "cli-authenticated") {
	let activeScenario = scenario;
	const connections: AntigravityAcpConnection[] = [];
	const environments: NodeJS.ProcessEnv[] = [];
	const log = path.join(root, `calls-${runtimes.length}.jsonl`);
	const store = new AcpSessionStore(path.join(root, `sessions-${runtimes.length}.json`));
	const runtime = new AntigravityRuntime((options) => {
		environments.push(options.env!);
		const connection = new AntigravityAcpConnection({ ...options, command: process.execPath,
			args: [fakeAgent, activeScenario], env: { ...options.env, FAKE_AGENT_LOG_FILE: log } });
		connections.push(connection);
		return connection;
	}, "default", store);
	runtimes.push(runtime);
	const { provider } = createAntigravityProvider(runtime);
	const models = createModels();
	models.setProvider(provider);
	const login = () => models.login(provider.id, "oauth", {
		notify() {}, prompt: async () => { throw new Error("CLI cached login must not open a login prompt"); },
	});
	const methods = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line).method) : [];
	return { runtime, provider, models, login, connections, environments, store, methods,
		setScenario: (value: string) => { activeScenario = value; } };
}

describe("CLI-owned authentication", () => {
	it("requires explicit selection and an executable AGY_ACP_BIN override", () => {
		vi.stubEnv(AUTH_BACKEND_ENV, "typo");
		expect(() => authenticationBackend()).toThrow("must be standalone or cli");
		vi.stubEnv(AUTH_BACKEND_ENV, "cli");
		vi.stubEnv("AGY_ACP_BIN", path.join(root, "missing"));
		expect(() => authenticationBackend()).toThrow();
	});

	it("scopes markers to the selected backend and CLI launcher", () => {
		const marker = newGoogleLoginMarker();
		expect(savedGoogleLogin(marker)).toBe(marker);
		expect(() => savedGoogleLogin(`${MANAGED_AUTH_MARKER}:old-login`)).toThrow("different authentication backend");
		const other = path.join(root, process.platform === "win32" ? "other.exe" : "other");
		fs.writeFileSync(other, "", { mode: 0o700 });
		vi.stubEnv("AGY_ACP_BIN", other);
		expect(() => savedGoogleLogin(marker)).toThrow("different authentication backend");
		vi.stubEnv(AUTH_BACKEND_ENV, "standalone");
		expect(() => savedGoogleLogin(marker)).toThrow("different authentication backend");
		expect(() => savedGoogleLogin(`${MANAGED_AUTH_MARKER}:old-login`)).toThrow("No saved Google login");
	});

	it("validates cached CLI login without standalone tokens, OAuth RPCs, API-key fallback, or a browser", async () => {
		const { runtime, provider, models, login, connections, environments, methods } = setup();
		const parentEnv = { ...process.env };
		await expect(models.getAuth(provider.id)).resolves.toBeUndefined();
		await expect(models.checkAuth(provider.id)).resolves.toBeUndefined();
		expect(connections).toHaveLength(0);
		const credential = await login();
		expect(credential).toMatchObject({ type: "oauth", access: expect.stringMatching(/^pi-antigravity-acp:managed-by-cli:/u) });
		expect(methods()).toEqual(["initialize", "session/new"]);
		expect(connections.every((connection) => !connection.process.alive)).toBe(true);
		expect(fs.existsSync(path.join(providerAcpDirectory(), "acp_token.json"))).toBe(false);
		const count = connections.length;
		await models.getAuth(provider.id);
		await models.getAuth(provider.id);
		expect(connections).toHaveLength(count);
		const model = FALLBACK_MODELS[0]!;
		const result = await models.streamSimple(model, normalizeContext({ messages: [
			{ role: "user", content: "hello", timestamp: 1 },
		] }), { sessionId: "cli-turn", reasoning: "high" }).result();
		expect(result.stopReason).toBe("stop");
		expect(environments.every((env) => env.GEMINI_API_KEY === undefined)).toBe(true);
		expect(environments.every((env) => env.GEMINI_HOME === parentEnv.GEMINI_HOME)).toBe(true);
		expect(environments.every((env) => env.AGY_ACP_FORCE_FILE_STORAGE === parentEnv.AGY_ACP_FORCE_FILE_STORAGE)).toBe(true);
		expect(process.env).toEqual(parentEnv);
		expect(runtime.inspectLocalAuth().status).toBe("cli-managed (not probed)");
	});

	it("does not store a marker if CLI session creation rejects authentication", async () => {
		const { provider, models, login, connections } = setup("cli-unauthenticated");
		await expect(login()).rejects.toThrow("Run agy acp --login");
		await expect(models.getAuth(provider.id)).resolves.toBeUndefined();
		expect(connections.every((connection) => !connection.process.alive)).toBe(true);
	});

	it("does not mistake a standalone ACP executable for the CLI", async () => {
		const { login, methods, connections } = setup("ordinary-standalone");
		await expect(login()).rejects.toThrow("requires the Antigravity CLI ACP server");
		expect(methods()).toEqual(["initialize"]);
		expect(connections.every((connection) => !connection.process.alive)).toBe(true);
	});

	it("publishes models only with a CLI login marker, and Pi logout does not fall back to the CLI cache", async () => {
		const { provider, models, login, connections } = setup();
		const refresh = (credential?: Awaited<ReturnType<typeof login>>) => provider.refreshModels!({
			allowNetwork: true, signal: new AbortController().signal, ...(credential ? { credential } : {}),
			publish: async ({ update }) => { update?.(); return true; },
		});
		await refresh();
		expect(connections).toHaveLength(0);
		const credential = await login();
		await refresh(credential);
		expect(provider.getModels().some((model) => model.id === "gemini-test")).toBe(true);
		await models.logout(provider.id);
		await expect(models.getAuth(provider.id)).resolves.toBeUndefined();
		const count = connections.length;
		await refresh();
		expect(connections).toHaveLength(count);
	});

	it("never deletes standalone or shared credentials during CLI login/logout", async () => {
		const token = path.join(providerAcpDirectory(), "acp_token.json");
		fs.mkdirSync(path.dirname(token), { recursive: true });
		fs.writeFileSync(token, '{"refresh_token":"unrelated-profile-token"}');
		const shared = path.join(root, "shared", "antigravity-acp", "acp_token.json");
		fs.mkdirSync(path.dirname(shared), { recursive: true });
		fs.writeFileSync(shared, '{"refresh_token":"unrelated-shared-token"}');
		vi.stubEnv("GEMINI_HOME", path.dirname(path.dirname(shared)));
		const { runtime, models, login, store } = setup();
		await login();
		const model = FALLBACK_MODELS[0]!;
		await models.streamSimple(model, normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 1 }] }), { sessionId: "saved-cli" }).result();
		expect(store.get("saved-cli")).toBeDefined();
		await runtime.logout();
		expect(store.get("saved-cli")).toBeUndefined();
		expect((await runtime.snapshot()).bindings).toBe(0);
		expect(fs.readFileSync(token, "utf8")).toBe('{"refresh_token":"unrelated-profile-token"}');
		expect(fs.readFileSync(shared, "utf8")).toBe('{"refresh_token":"unrelated-shared-token"}');
		expect(runtime.logoutDescription()).toContain("CLI credentials are unchanged");
		expect(runtime.credentialStorageDescription()).toContain("not isolated by Pi profile");
	});

	it("rejects unsupported CLI quota and API keys without starting a process", async () => {
		const { runtime, connections } = setup();
		await expect(runtime.quota(newGoogleLoginMarker())).rejects.toThrow("Use /usage in the Antigravity CLI");
		await expect(runtime.verifyApiKey("key")).rejects.toThrow("cached Google login");
		await expect(runtime.discoverModels("key")).rejects.toThrow("not a Pi API key");
		expect(connections).toHaveLength(0);
	});

	it("lets the CLI reject a revoked cached login on the next request", async () => {
		const { provider, models, login, setScenario } = setup();
		await login();
		setScenario("cli-unauthenticated");
		const result = await models.streamSimple(FALLBACK_MODELS[0]!, normalizeContext({ messages: [
			{ role: "user", content: "hello", timestamp: 1 },
		] })).result();
		expect(result).toMatchObject({ stopReason: "error", errorMessage: expect.stringContaining("authentication required") });
		await models.logout(provider.id);
		await expect(models.getAuth(provider.id)).resolves.toBeUndefined();
	});

	it("does not configure the standalone credential store during CLI setup", async () => {
		await ensureAntigravityAcpReady();
		expect(fs.existsSync(providerAcpDirectory())).toBe(false);
	});

	it("honors cancellation during CLI initialization and stores no marker", async () => {
		const { models, provider, connections } = setup("cli-initialize-timeout");
		const controller = new AbortController();
		const pending = models.login(provider.id, "oauth", { signal: controller.signal,
			notify() {}, prompt: async () => "", });
		const rejected = expect(pending).rejects.toThrow();
		await vi.waitFor(() => expect(connections).toHaveLength(1));
		controller.abort();
		await rejected;
		await vi.waitFor(() => expect(connections.every((connection) => !connection.process.alive)).toBe(true));
		await expect(models.getAuth(provider.id)).resolves.toBeUndefined();
	});
});
