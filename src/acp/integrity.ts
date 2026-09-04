import { createHash } from "node:crypto";
import fs from "node:fs";

export interface PinnedPlatformRuntime {
	archive: string;
	archiveSha256: string;
	binaryName: "agy_acp_server.par" | "agy_acp_server.exe";
	binarySha256?: string;
}

export const PINNED_RUNTIME_VERSION = "1.1.1";

/** Exact Google artifact URLs and independently measured archive hashes
 * reviewed for this release. The Linux x64 binary hash was also measured from
 * the authenticated live-test installation. Upstream does not publish hashes. */
export const PINNED_RUNTIME: Readonly<Record<string, PinnedPlatformRuntime>> = {
	"darwin-aarch64": {
		archive: "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-agy_acp_server_1.1.1-darwin-arm64.zip",
		archiveSha256: "fdfa915652cdb7ba8085cc8fffed072cbe009251aa2c951aabdda07a8c28a189",
		binaryName: "agy_acp_server.par",
	},
	"linux-x86_64": {
		archive: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_1.1.1-linux-x86_64.zip",
		archiveSha256: "38f62d01b32deb0907b3d39a71ec301fd36369f6ffd1cf262d4af385177f79df",
		binaryName: "agy_acp_server.par",
		binarySha256: "267affa691085fe5d78895e34dffe723d6528713e01bd37ed40feb7b43d1f4c7",
	},
	"linux-aarch64": {
		archive: "https://dl.google.com/agy-extensions/releases/linux/agy-acp-server-agy_acp_server_1.1.1-linux-arm64.zip",
		archiveSha256: "ed69e64b308fcb123ab54bf3277bf9cb0d651064f885ea5aab0ff520c7175398",
		binaryName: "agy_acp_server.par",
	},
	"windows-x86_64": {
		archive: "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-agy_acp_server_1.1.1-windows-x86_64.zip",
		archiveSha256: "47cb50eef14f0a4655d78cfcfda869bcea7aaee5f9787e936bc2935ea612c3b8",
		binaryName: "agy_acp_server.exe",
	},
	"windows-aarch64": {
		archive: "https://dl.google.com/agy-extensions/releases/windows/agy-acp-server-agy_acp_server_1.1.1-windows-arm64.zip",
		archiveSha256: "35f4b1f47ba6a3fea7b0a3e30010df5ea73a64b4f0e7cf991cddc673ddfbcafc",
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

export function verifyPinnedArchive(key: string, actual: string): string {
	const expected = pinnedPlatform(key).archiveSha256;
	if (actual !== expected) throw new Error(`Antigravity ACP archive SHA-256 mismatch for ${key}`);
	return actual;
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
