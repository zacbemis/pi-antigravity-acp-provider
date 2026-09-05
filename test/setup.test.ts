import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { repairRuntimeExecutablePermissions } from "../src/acp/setup.js";

const directories: string[] = [];
afterEach(() => {
	for (const directory of directories.splice(0)) {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});

describe("managed runtime executable permissions", () => {
	it("repairs the server and local harness after zip extraction", () => {
		const directory = temporaryDirectory();
		for (const name of ["agy_acp_server.par", "localharness_external"]) {
			fs.writeFileSync(path.join(directory, name), name, { mode: 0o644 });
		}

		expect(repairRuntimeExecutablePermissions(directory, "linux")).toEqual([
			"agy_acp_server.par",
			"localharness_external",
		]);
		for (const name of ["agy_acp_server.par", "localharness_external"]) {
			expect(fs.statSync(path.join(directory, name)).mode & 0o111).toBe(0o111);
		}
		expect(repairRuntimeExecutablePermissions(directory, "linux")).toEqual([]);
	});

	it("does not chmod payloads on Windows", () => {
		const directory = temporaryDirectory();
		const helper = path.join(directory, "localharness_external");
		fs.writeFileSync(helper, "helper", { mode: 0o644 });

		expect(repairRuntimeExecutablePermissions(directory, "win32")).toEqual([]);
		expect(fs.statSync(helper).mode & 0o111).toBe(0);
	});

	it("rejects a missing managed runtime payload", () => {
		const directory = temporaryDirectory();
		expect(() => repairRuntimeExecutablePermissions(directory, "linux")).toThrow(
			"Managed ACP runtime payload is missing: agy_acp_server.par",
		);
	});

	it("rejects a managed helper that is not a regular file", () => {
		const directory = temporaryDirectory();
		fs.writeFileSync(path.join(directory, "agy_acp_server.par"), "server", { mode: 0o755 });
		fs.mkdirSync(path.join(directory, "localharness_external"));
		expect(() => repairRuntimeExecutablePermissions(directory, "linux")).toThrow(
			"Managed ACP runtime payload is not a regular file",
		);
	});
});

function temporaryDirectory(): string {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-setup-"));
	directories.push(directory);
	return directory;
}
