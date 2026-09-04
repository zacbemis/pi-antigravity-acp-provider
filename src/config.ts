import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PermissionMode = "default" | "auto_edit" | "yolo";

export interface GeminiAcpConfig {
	permissions: PermissionMode;
}

export const CONFIG_PATH = path.join(
	os.homedir(),
	".pi",
	"agent",
	"gemini-acp-provider",
	"config.json",
);

export function loadConfig(file = CONFIG_PATH): GeminiAcpConfig {
	try {
		const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { permissions?: unknown };
		if (isPermissionMode(parsed.permissions)) return { permissions: parsed.permissions };
	} catch {
		// Missing or malformed configuration uses the documented default.
	}
	return { permissions: "yolo" };
}

export function savePermissionMode(mode: PermissionMode, file = CONFIG_PATH): void {
	const directory = path.dirname(file);
	fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
	const temporary = `${file}.${process.pid}.tmp`;
	fs.writeFileSync(temporary, `${JSON.stringify({ permissions: mode }, null, 2)}\n`, {
		mode: 0o600,
	});
	fs.renameSync(temporary, file);
}

export function isPermissionMode(value: unknown): value is PermissionMode {
	return value === "default" || value === "auto_edit" || value === "yolo";
}

export function permissionModeLabel(mode: PermissionMode): string {
	if (mode === "auto_edit") return "auto-edit";
	return mode;
}
