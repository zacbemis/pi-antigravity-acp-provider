import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type PermissionMode = "default" | "auto_edit" | "yolo";

export interface AntigravityAcpConfig {
	permissions: PermissionMode;
}

const CONFIG_ROOT = path.join(os.homedir(), ".pi", "agent", "antigravity-acp-provider");
export const CONFIG_PATH = path.join(CONFIG_ROOT, "config.json");
export const LEGACY_CONFIG_PATH = path.join(
	os.homedir(),
	".pi",
	"agent",
	"gemini-acp-provider",
	"config.json",
);

export function loadConfig(file = CONFIG_PATH): AntigravityAcpConfig {
	if (file === CONFIG_PATH) migrateLegacyConfig();
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

function migrateLegacyConfig(): void {
	if (fs.existsSync(CONFIG_PATH) || !fs.existsSync(LEGACY_CONFIG_PATH)) return;
	try {
		fs.mkdirSync(CONFIG_ROOT, { recursive: true, mode: 0o700 });
		fs.copyFileSync(LEGACY_CONFIG_PATH, CONFIG_PATH, fs.constants.COPYFILE_EXCL);
		fs.chmodSync(CONFIG_PATH, 0o600);
	} catch {
		// Migration is best-effort; defaults remain available.
	}
}

export function isPermissionMode(value: unknown): value is PermissionMode {
	return value === "default" || value === "auto_edit" || value === "yolo";
}

export function permissionModeLabel(mode: PermissionMode): string {
	if (mode === "auto_edit") return "auto-edit";
	return mode;
}
