import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	assertPinnedArchive,
	PINNED_RUNTIME,
	sha256File,
} from "../src/acp/integrity.js";

const files: string[] = [];
afterEach(() => {
	for (const file of files.splice(0)) fs.rmSync(file, { force: true });
});

describe("runtime integrity", () => {
	it("rejects registry URL drift", () => {
		expect(() => assertPinnedArchive("linux-x86_64", "https://example.com/runtime.zip")).toThrow(
			/unreviewed runtime/u,
		);
		expect(assertPinnedArchive("linux-x86_64", PINNED_RUNTIME["linux-x86_64"]!.archive)).toBeDefined();
	});

	it("hashes files deterministically", async () => {
		const file = path.join(os.tmpdir(), `antigravity-hash-${process.pid}-${Date.now()}`);
		files.push(file);
		fs.writeFileSync(file, "abc");
		await expect(sha256File(file)).resolves.toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});
