import { createHash } from "node:crypto";
import fs from "node:fs";

export interface PinnedPlatformRuntime {
	archive: string;
	binaryName: "agy_acp_server.par" | "agy_acp_server.exe";
	binarySha256?: string;
}

export const PINNED_RUNTIME_VERSION = "1.1.1";

/** Exact immutable Google artifact URLs reviewed for this release. The Linux
 * x64 binary hash was independently measured from the authenticated live-test
 * installation. Upstream does not publish archive checksums. */
export const PINNED_RUNTIME: Readonly<Record<string, PinnedPlatformRuntime>> = {
	"darwin-aarch64": {
		archive: "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-agy_acp_server_1.1.1-darwin-arm64.zip",
		binaryName: "agy_acp_server.par",
	},
	"linux-x86_64": {
		archive: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_1.1.1-linux-x86_64.zip",
		binaryName: "agy_acp_server.par",
		binarySha256: "267affa691085fe5d78895e34dffe723d6528713e01bd37ed40feb7b43d1f4c7",
	},
	"linux-aarch64": {
		archive: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_1.1.1-linux-arm64.zip",
		binaryName: "agy_acp_server.par",
	},
	"windows-x86_64": {
		archive: "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-agy_acp_server_1.1.1-windows-x86_64.zip",
		binaryName: "agy_acp_server.exe",
	},
	"windows-aarch64": {
		archive: "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-agy_acp_server_1.1.1-windows-arm64.zip",
		binaryName: "agy_acp_server.exe",
	},
};

export function pinnedPlatform(key: string): PinnedPlatformRuntime {
	const runtime = PINNED_RUNTIME[key];
	if (!runtime) throw new Error(`No pinned Antigravity ACP ${PINNED_RUNTIME_VERSION} build for ${key}`);
	return runtime;
}

export function assertPinnedArchive(key: string, archive: string): PinnedPlatformRuntime {
	const pinned = pinnedPlatform(key);
	if (archive !== pinned.archive) {
		throw new Error(
			`ACP registry artifact differs from pinned ${PINNED_RUNTIME_VERSION} ${key} URL; refusing unreviewed runtime`,
		);
	}
	return pinned;
}

export async function sha256File(file: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

export async function verifyPinnedBinary(key: string, file: string): Promise<string> {
	const actual = await sha256File(file);
	const expected = pinnedPlatform(key).binarySha256;
	if (expected && actual !== expected) {
		throw new Error(`Antigravity ACP binary SHA-256 mismatch for ${key}`);
	}
	return actual;
}
