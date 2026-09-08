import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
	BUNDLED_RUNTIME_MANIFEST,
	compareRuntimeVersions,
	latestManifestRelease,
	parseTrustedRuntimeManifest,
	readBundledRuntimeManifest,
} from "../src/acp/runtime-manifest.js";
import { selectApprovedRelease } from "../src/acp/setup.js";

describe("signed Antigravity runtime manifest", () => {
	it("verifies the bundled signature and selects the newest release", () => {
		const manifest = readBundledRuntimeManifest();
		expect(latestManifestRelease(manifest).version).toBe("1.1.1");
		expect(latestManifestRelease(manifest).platforms["linux-x86_64"]).toMatchObject({
			archiveSha256: "38f62d01b32deb0907b3d39a71ec301fd36369f6ffd1cf262d4af385177f79df",
			archiveBytes: 681_969_407,
			binaryBytes: 1_880_360_328,
			harnessBytes: 128_966_920,
		});
	});

	it("rejects a manifest changed after signing", () => {
		const text = fs.readFileSync(BUNDLED_RUNTIME_MANIFEST, "utf8").replace("1.1.1", "1.1.2");
		expect(() => parseTrustedRuntimeManifest(text)).toThrow("signature is invalid");
	});

	it("selects only a release approved by the signed manifest", () => {
		const manifest = readBundledRuntimeManifest();
		expect(selectApprovedRelease(manifest, "1.1.1")?.version).toBe("1.1.1");
		expect(selectApprovedRelease(manifest, "1.2.0")).toBeUndefined();
	});

	it("compares strict semantic runtime versions", () => {
		expect(compareRuntimeVersions("1.2.0", "1.1.9")).toBe(1);
		expect(compareRuntimeVersions("1.1.1", "1.1.1")).toBe(0);
		expect(compareRuntimeVersions("1.0.9", "1.1.0")).toBe(-1);
		expect(() => compareRuntimeVersions("latest", "1.1.0")).toThrow("Invalid Antigravity ACP version");
	});
});
