import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Open } from "unzipper";

const REGISTRY_URL =
	"https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json";
const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;
const manifestPath = path.resolve(process.argv[2] ?? "runtime-manifest.json");
const response = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`ACP registry returned HTTP ${response.status}`);
const registry = await response.json();
const version = String(registry.version ?? "");
if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error(`Invalid registry version: ${version}`);
const entries = registry.distribution?.binary;
if (!entries || typeof entries !== "object") throw new Error("Registry binary distribution is missing");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.releases.some((release) => release.version === version)) {
	console.log(`Antigravity ACP ${version} is already present in the signed manifest.`);
	process.exit(0);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-runtime-manifest-"));
try {
	const platforms = {};
	for (const [platform, entry] of Object.entries(entries)) {
		if (!["darwin-aarch64", "linux-x86_64", "linux-aarch64", "windows-x86_64", "windows-aarch64"].includes(platform)) {
			throw new Error(`Unsupported registry platform: ${platform}`);
		}
		const windows = platform.startsWith("windows-");
		const binaryName = windows ? "agy_acp_server.exe" : "agy_acp_server.par";
		const harnessName = windows ? "localharness_external.exe" : "localharness_external";
		validateArchiveUrl(entry.archive, version);
		const commandName = path.posix.basename(String(entry.cmd ?? binaryName).replaceAll("\\", "/"));
		if (commandName !== binaryName) throw new Error(`Unexpected registry command for ${platform}`);
		const archivePath = path.join(temporary, `${platform}.zip`);
		console.log(`Downloading ${platform}…`);
		const downloaded = await download(entry.archive, archivePath);
		const archive = await Open.file(archivePath);
		if (archive.files.length !== 2) throw new Error(`${platform} archive must contain exactly two files`);
		const binary = archive.files.find((file) => file.path === binaryName);
		const harness = archive.files.find((file) => file.path === harnessName);
		for (const file of [binary, harness]) {
			if (
				!file ||
				file.type !== "File" ||
				file.path.includes("/") ||
				file.path.includes("\\") ||
				![0, 8].includes(file.compressionMethod) ||
				!Number.isSafeInteger(file.uncompressedSize) ||
				file.uncompressedSize <= 0
			) {
				throw new Error(`${platform} archive contains an unsafe runtime file`);
			}
		}
		platforms[platform] = {
			archive: entry.archive,
			archiveSha256: downloaded.sha256,
			archiveBytes: downloaded.bytes,
			binaryName,
			binaryBytes: binary.uncompressedSize,
			harnessName,
			harnessBytes: harness.uncompressedSize,
			args: Array.isArray(entry.args) ? entry.args : [],
		};
		fs.rmSync(archivePath, { force: true });
	}
	manifest.generatedAt = new Date().toISOString();
	manifest.releases = [...manifest.releases, { version, platforms }]
		.sort((left, right) => compareVersions(left.version, right.version))
		.slice(-5);
	manifest.signature = "";
	fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`Added Antigravity ACP ${version}; sign runtime-manifest.json before publishing.`);
} finally {
	fs.rmSync(temporary, { recursive: true, force: true });
}

async function download(url, destination) {
	const response = await fetch(url, { signal: AbortSignal.timeout(45 * 60_000) });
	if (!response.ok || !response.body) throw new Error(`Download returned HTTP ${response.status}`);
	const hash = createHash("sha256");
	let bytes = 0;
	const meter = new TransformStream({
		transform(chunk, controller) {
			bytes += chunk.byteLength;
			if (bytes > MAX_ARCHIVE_BYTES) throw new Error("Runtime archive exceeded the 4 GiB safety limit");
			hash.update(chunk);
			controller.enqueue(chunk);
		},
	});
	await pipeline(response.body.pipeThrough(meter), fs.createWriteStream(destination, { flags: "wx", mode: 0o600 }));
	return { bytes, sha256: hash.digest("hex") };
}

function validateArchiveUrl(value, version) {
	const url = new URL(value);
	if (
		url.protocol !== "https:" ||
		url.hostname !== "dl.google.com" ||
		url.username || url.password || url.port ||
		!url.pathname.startsWith("/agy-extensions/releases/") ||
		url.search ||
		url.hash ||
		!path.posix.basename(url.pathname).includes(`_${version}-`)
	) {
		throw new Error(`Untrusted registry archive URL: ${value}`);
	}
}

function compareVersions(left, right) {
	const a = left.split(".").map(Number);
	const b = right.split(".").map(Number);
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return a[index] - b[index];
	}
	return 0;
}
