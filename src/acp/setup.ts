import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";
import { Extract } from "unzipper";

import { resolveAntigravityAcpLaunch } from "./antigravity.js";
import { GeminiAcpError } from "./errors.js";

// Installation layout and registry protocol follow the MIT-licensed
// @estebanforge/pi-antigravity-bridge 1.4.1 setup implementation.
const REGISTRY_URL =
	"https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json";
const INSTALL_TIMEOUT_MS = 30 * 60_000;
let inFlight: Promise<void> | undefined;

interface RegistryEntry {
	archive: string;
	cmd?: string;
}

export function ensureAntigravityAcpReady(): Promise<void> {
	inFlight ??= ensureOnce().finally(() => {
		inFlight = undefined;
	});
	return inFlight;
}

async function ensureOnce(): Promise<void> {
	configureDefaultAuth();
	try {
		resolveAntigravityAcpLaunch();
		return;
	} catch {
		// Install the official registry artifact below.
	}

	try {
		const entry = await registryEntry();
		const build = buildId(entry.archive);
		const root = path.join(os.homedir(), ".local", "opt", "agy-acp");
		const destination = path.join(root, build);
		const commandName = (entry.cmd ?? "./agy_acp_server.par").replace(/^\.\//u, "");
		const binary = path.join(destination, commandName);
		if (!isExecutable(binary)) {
			fs.mkdirSync(root, { recursive: true });
			const staging = fs.mkdtempSync(path.join(root, `.install-${build}-`));
			const archive = path.join(staging, "server.zip");
			try {
				await download(entry.archive, archive);
				await pipeline(fs.createReadStream(archive), Extract({ path: staging }));
				fs.rmSync(archive, { force: true });
				const stagedBinary = path.join(staging, commandName);
				if (!fs.existsSync(stagedBinary)) throw new Error(`${commandName} is missing from the registry archive`);
				fs.chmodSync(stagedBinary, 0o755);
				fs.rmSync(destination, { recursive: true, force: true });
				fs.renameSync(staging, destination);
			} catch (error) {
				fs.rmSync(staging, { recursive: true, force: true });
				throw error;
			}
		}
		process.env.AGY_ACP_BIN = binary;
		resolveAntigravityAcpLaunch();
	} catch (cause) {
		throw new GeminiAcpError(
			"spawn",
			`Automatic Google Antigravity ACP installation failed: ${cause instanceof Error ? cause.message : String(cause)}. Install agy ACP manually or set AGY_ACP_BIN.`,
			{ cause },
		);
	}
}

async function registryEntry(): Promise<RegistryEntry> {
	const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error(`ACP registry returned HTTP ${response.status}`);
	const document = (await response.json()) as {
		distribution?: { binary?: Record<string, RegistryEntry> };
	};
	const entry = document.distribution?.binary?.[platformKey()];
	if (!entry?.archive || !entry.archive.startsWith("https://")) {
		throw new Error(`ACP registry has no trusted ${platformKey()} artifact`);
	}
	return entry;
}

async function download(url: string, destination: string): Promise<void> {
	const response = await fetch(url, { signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS) });
	if (!response.ok || !response.body) throw new Error(`ACP server download returned HTTP ${response.status}`);
	await pipeline(response.body, fs.createWriteStream(destination, { mode: 0o600 }));
}

function configureDefaultAuth(): void {
	const directory = path.join(os.homedir(), ".gemini", "antigravity-acp");
	const settingsFile = path.join(directory, "settings.json");
	const tokenFile = path.join(directory, "acp_token.json");
	if (fs.existsSync(tokenFile) || fs.existsSync(settingsFile)) return;
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const type = process.env.GEMINI_API_KEY ? "gemini-api-key" : "oauth-personal";
	fs.writeFileSync(settingsFile, `${JSON.stringify({ auth: { type } }, null, 2)}\n`, { mode: 0o600 });
}

function platformKey(): string {
	const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
	const architecture = process.arch === "arm64" ? "aarch64" : "x86_64";
	return `${platform}-${architecture}`;
}

function buildId(url: string): string {
	const name = path.posix.basename(new URL(url).pathname, ".zip");
	const match = name.match(/^agy-acp-server-(.+)-(?:darwin|linux|windows)-(?:arm64|x86_64)$/u);
	if (!match?.[1]) throw new Error(`Unrecognized ACP archive name: ${name}`);
	return match[1];
}

function isExecutable(file: string): boolean {
	try {
		fs.accessSync(file, fs.constants.X_OK);
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}
