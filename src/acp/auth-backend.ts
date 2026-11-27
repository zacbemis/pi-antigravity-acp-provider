import { resolveAntigravityAcpLaunch } from "./antigravity.js";
import { providerAcpEnvironment } from "./credential-storage.js";
import { AntigravityAcpError } from "./errors.js";

export const AUTH_BACKEND_ENV = "PI_ANTIGRAVITY_ACP_AUTH_BACKEND";

export type AuthenticationBackend =
	| { kind: "standalone" }
	| { kind: "cli"; launcher: string };

export function authenticationBackend(): AuthenticationBackend {
	const kind = process.env[AUTH_BACKEND_ENV]?.trim() || "standalone";
	if (kind === "standalone") return { kind };
	if (kind !== "cli") throw new AntigravityAcpError("auth", `${AUTH_BACKEND_ENV} must be standalone or cli`);
	const launch = resolveAntigravityAcpLaunch();
	if (launch.source !== "env") {
		throw new AntigravityAcpError("auth", "CLI authentication requires AGY_ACP_BIN pointing to an executable wrapper for agy acp");
	}
	return { kind, launcher: launch.command };
}

export function authenticationEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return authenticationBackend().kind === "cli" ? { ...env } : providerAcpEnvironment(env);
}
