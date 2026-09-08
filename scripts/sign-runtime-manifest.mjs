import { sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const manifestPath = path.resolve(process.argv[2] ?? "runtime-manifest.json");
const keyPath = path.resolve(
	process.env.ACP_RUNTIME_MANIFEST_PRIVATE_KEY_PATH ??
		path.join(os.homedir(), ".config", "pi-antigravity-acp-provider", "runtime-manifest-private.pem"),
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const payload = {
	schemaVersion: manifest.schemaVersion,
	generatedAt: manifest.generatedAt,
	releases: manifest.releases,
};
manifest.signature = sign(
	null,
	Buffer.from(canonicalJson(payload)),
	fs.readFileSync(keyPath, "utf8"),
).toString("base64");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

function canonicalJson(value) {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value)
			.filter(([, child]) => child !== undefined)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}
