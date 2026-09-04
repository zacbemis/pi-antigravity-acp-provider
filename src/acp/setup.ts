import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { Extract } from "unzipper";

import { resolveAntigravityAcpLaunch, type AntigravityLaunch } from "./antigravity.js";
import { AntigravityAcpError } from "./errors.js";
import {
	assertPinnedArchive,
	PINNED_RUNTIME_VERSION,
	verifyPinnedArchive,
	verifyPinnedBinary,
} from "./integrity.js";

const execFileAsync = promisify(execFile);
const REGISTRY_URL =
	"https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json";
const INSTALL_TIMEOUT_MS = 30 * 60_000;
let inFlight: Promise<void> | undefined;

interface RegistryEntry {
	archive: string;
	cmd?: string;
	args?: string[];
}

export interface RuntimeSetupStatus {
	installed: boolean;
	launch?: AntigravityLaunch;
	pinnedVersion: string;
	platform: string;
	musl: boolean;
}

export function inspectRuntimeSetup(): RuntimeSetupStatus {
	let launch: AntigravityLaunch | undefined;
	try {
		launch = resolveAntigravityAcpLaunch();
	} catch {
		// Not installed.
	}
	return {
		installed: launch !== undefined,
		...(launch ? { launch } : {}),
		pinnedVersion: PINNED_RUNTIME_VERSION,
		platform: platformKey(),
		musl: isMuslLinux(),
	};
}

export function ensureAntigravityAcpReady(onProgress?: (message: string) => void): Promise<void> {
	inFlight ??= ensureOnce(onProgress).finally(() => {
		inFlight = undefined;
	});
	return inFlight;
}

export async function updateAntigravityAcpRuntime(
	onProgress?: (message: string) => void,
): Promise<{ version: string; changed: boolean; binary: string }> {
	configureDefaultAuth();
	return installPinnedRuntime(onProgress);
}

async function ensureOnce(onProgress?: (message: string) => void): Promise<void> {
	configureDefaultAuth();
	try {
		resolveAntigravityAcpLaunch();
		return;
	} catch {
		// Install the reviewed registry artifact below.
	}
	await installPinnedRuntime(onProgress);
}

async function installPinnedRuntime(
	onProgress?: (message: string) => void,
): Promise<{ version: string; changed: boolean; binary: string }> {
	try {
		if (isMuslLinux()) {
			throw new Error(
				"Google publishes a glibc Linux binary; Alpine/musl is not supported. Use a glibc container or AGY_ACP_BIN override.",
			);
		}
		onProgress?.("Checking the official ACP registry against the pinned runtime…");
		const key = platformKey();
		const entry = await registryEntry(key);
		const pinned = assertPinnedArchive(key, entry.archive);
		const root = path.join(os.homedir(), ".local", "opt", "agy-acp");
		const destination = path.join(root, PINNED_RUNTIME_VERSION);
		const commandName = (entry.cmd ?? pinned.binaryName).replace(/^\.\//u, "");
		if (commandName !== pinned.binaryName) throw new Error("ACP registry command differs from the pinned manifest");
		const binary = path.join(destination, commandName);
		let changed = false;
		if (!isExecutable(binary)) {
			changed = true;
			fs.mkdirSync(root, { recursive: true, mode: 0o700 });
			const staging = fs.mkdtempSync(path.join(root, `.install-${PINNED_RUNTIME_VERSION}-`));
			const archive = path.join(staging, "server.zip");
			try {
				onProgress?.("Downloading the Antigravity ACP server (this is a large download)…");
				const archiveSha256 = verifyPinnedArchive(
					key,
					await download(entry.archive, archive, onProgress),
				);
				onProgress?.("Extracting and verifying the Antigravity ACP server…");
				await pipeline(fs.createReadStream(archive), Extract({ path: staging }));
				fs.rmSync(archive, { force: true });
				const stagedBinary = path.join(staging, commandName);
				if (!fs.existsSync(stagedBinary)) throw new Error(`${commandName} is missing from the registry archive`);
				fs.chmodSync(stagedBinary, 0o755);
				await verifyPinnedBinary(key, stagedBinary);
				fs.writeFileSync(
					path.join(staging, "install-integrity.json"),
					`${JSON.stringify({ version: PINNED_RUNTIME_VERSION, platform: key, archiveSha256 }, null, 2)}\n`,
					{ mode: 0o600 },
				);
				if (process.platform === "darwin") {
					await execFileAsync("xattr", ["-d", "com.apple.quarantine", stagedBinary]).catch(() => undefined);
				}
				fs.rmSync(destination, { recursive: true, force: true });
				fs.renameSync(staging, destination);
			} catch (error) {
				fs.rmSync(staging, { recursive: true, force: true });
				throw error;
			}
		}
		pointCurrentAt(root, destination);
		process.env.AGY_ACP_BIN = binary;
		resolveAntigravityAcpLaunch();
		onProgress?.(`Antigravity ACP ${PINNED_RUNTIME_VERSION} is ready.`);
		return { version: PINNED_RUNTIME_VERSION, changed, binary };
	} catch (cause) {
		throw new AntigravityAcpError(
			"spawn",
			`Google Antigravity ACP setup failed: ${cause instanceof Error ? cause.message : String(cause)}. Set AGY_ACP_BIN to a trusted manual installation if needed.`,
			{ cause },
		);
	}
}

async function registryEntry(key: string): Promise<RegistryEntry> {
	const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(15_000) });
	if (!response.ok) throw new Error(`ACP registry returned HTTP ${response.status}`);
	const document = (await response.json()) as {
		distribution?: { binary?: Record<string, RegistryEntry> };
	};
	const entry = document.distribution?.binary?.[key];
	if (!entry?.archive || !entry.archive.startsWith("https://dl.google.com/")) {
		throw new Error(`ACP registry has no trusted ${key} artifact`);
	}
	return entry;
}

async function download(
	url: string,
	destination: string,
	onProgress?: (message: string) => void,
): Promise<string> {
	const response = await fetch(url, { signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS) });
	if (!response.ok || !response.body) throw new Error(`ACP server download returned HTTP ${response.status}`);
	const total = Number(response.headers.get("content-length") ?? 0);
	const hash = createHash("sha256");
	let received = 0;
	let lastReported = 0;
	const progress = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			hash.update(chunk);
			received += chunk.byteLength;
			if (total > 0) {
				const percent = Math.floor((received / total) * 100);
				if (percent >= lastReported + 10) {
					lastReported = percent;
					onProgress?.(`Downloading Antigravity ACP: ${percent}%`);
				}
			}
			controller.enqueue(chunk);
		},
	});
	await pipeline(response.body.pipeThrough(progress), fs.createWriteStream(destination, { mode: 0o600 }));
	return hash.digest("hex");
}

function pointCurrentAt(root: string, destination: string): void {
	const current = path.join(root, "current");
	const temporary = path.join(root, `.current-${process.pid}`);
	fs.rmSync(temporary, { recursive: true, force: true });
	fs.symlinkSync(
		process.platform === "win32" ? destination : path.basename(destination),
		temporary,
		process.platform === "win32" ? "junction" : "dir",
	);
	fs.rmSync(current, { recursive: true, force: true });
	fs.renameSync(temporary, current);
}

function configureDefaultAuth(): void {
	const directory = path.join(os.homedir(), ".gemini", "antigravity-acp");
	const settingsFile = path.join(directory, "settings.json");
	const tokenFile = path.join(directory, "acp_token.json");
	if (fs.existsSync(tokenFile)) return;
	let settings: Record<string, unknown> = {};
	try {
		settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")) as Record<string, unknown>;
		if (settings.auth && typeof settings.auth === "object") return;
	} catch {
		// Create or repair settings below.
	}
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const type = process.env.GEMINI_API_KEY ? "gemini-api-key" : "oauth-personal";
	fs.writeFileSync(settingsFile, `${JSON.stringify({ ...settings, auth: { type } }, null, 2)}\n`, { mode: 0o600 });
}

export function platformKey(): string {
	if (!(process.platform === "linux" || process.platform === "darwin" || process.platform === "win32")) {
		throw new Error(`Unsupported Antigravity ACP platform: ${process.platform}`);
	}
	if (process.arch !== "x64" && process.arch !== "arm64") {
		throw new Error(`Unsupported Antigravity ACP architecture: ${process.arch}`);
	}
	const platform = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
	const architecture = process.arch === "arm64" ? "aarch64" : "x86_64";
	return `${platform}-${architecture}`;
}

export function isMuslLinux(): boolean {
	if (process.platform !== "linux") return false;
	if (fs.existsSync("/etc/alpine-release")) return true;
	const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
	return !report?.header?.glibcVersionRuntime;
}

function isExecutable(file: string): boolean {
	try {
		fs.accessSync(file, fs.constants.X_OK);
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}
