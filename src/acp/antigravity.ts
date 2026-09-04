import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { GeminiAcpError } from "./errors.js";

export interface AntigravityLaunch {
	command: string;
	args: string[];
	source: "env" | "user-bin" | "managed" | "path";
}

export function resolveAntigravityAcpLaunch(): AntigravityLaunch {
	const env = process.env.AGY_ACP_BIN?.trim();
	if (env) {
		const command = expandHome(env);
		if (executable(command)) return directOrWrapper(command, "env");
	}

	const userBin = path.join(os.homedir(), ".local", "bin", "agy_acp_server.par");
	if (executable(userBin)) return { command: userBin, args: [], source: "user-bin" };

	const managedRoot = path.join(os.homedir(), ".local", "opt", "agy-acp", "current");
	for (const name of ["agy_acp_server.par", "agy_acp_server.exe"]) {
		const managed = path.join(managedRoot, name);
		if (executable(managed)) return directOrWrapper(managed, "managed");
	}

	for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
		if (!directory) continue;
		const candidate = path.join(directory, "agy_acp_server.par");
		if (executable(candidate)) return directOrWrapper(candidate, "path");
	}

	throw new GeminiAcpError(
		"spawn",
		"Google Antigravity ACP server is not installed. Install/enable agy ACP or set AGY_ACP_BIN.",
	);
}

export function hasAntigravityAuth(): boolean {
	const directory = path.join(os.homedir(), ".gemini", "antigravity-acp");
	if (regularFile(path.join(directory, "acp_token.json"))) return true;
	try {
		const settings = JSON.parse(fs.readFileSync(path.join(directory, "settings.json"), "utf8")) as {
			auth?: { type?: unknown };
		};
		return typeof settings.auth?.type === "string";
	} catch {
		return false;
	}
}

function directOrWrapper(command: string, source: AntigravityLaunch["source"]): AntigravityLaunch {
	try {
		const fd = fs.openSync(command, "r");
		const bytes = Buffer.alloc(64);
		const count = fs.readSync(fd, bytes, 0, bytes.length, 0);
		fs.closeSync(fd);
		if (bytes.subarray(0, count).toString("utf8").startsWith("#!")) {
			return { command, args: [], source };
		}
	} catch {
		// Native executable; use the server's required empty uid argument.
	}
	return { command, args: process.platform === "linux" ? ["--uid="] : [], source };
}

function executable(file: string): boolean {
	try {
		fs.accessSync(file, fs.constants.X_OK);
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

function regularFile(file: string): boolean {
	try {
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

function expandHome(file: string): string {
	return file === "~" || file.startsWith("~/") ? path.join(os.homedir(), file.slice(1)) : file;
}
