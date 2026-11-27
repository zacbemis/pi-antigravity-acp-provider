import { createHash, randomUUID } from "node:crypto";

import { inspectAntigravityAuth } from "./acp/antigravity.js";
import { authenticationBackend, type AuthenticationBackend } from "./acp/auth-backend.js";
import { providerAcpDirectory } from "./acp/credential-storage.js";
import { AntigravityAcpError } from "./acp/errors.js";
import { MANAGED_AUTH_MARKER } from "./constants.js";

const CLI_MARKER = "pi-antigravity-acp:managed-by-cli";

function markerPrefix(backend: AuthenticationBackend): string {
	if (backend.kind === "standalone") return MANAGED_AUTH_MARKER;
	const identity = createHash("sha256").update(backend.launcher).digest("hex");
	return `${CLI_MARKER}:${identity}`;
}

export function newGoogleLoginMarker(): string {
	return `${markerPrefix(authenticationBackend())}:${randomUUID()}`;
}

export function isGoogleLoginMarker(value: string): boolean {
	return value.startsWith(`${MANAGED_AUTH_MARKER}:`) || value.startsWith(`${CLI_MARKER}:`);
}

export function savedGoogleLogin(marker: string): string {
	const backend = authenticationBackend();
	if (!marker.startsWith(`${markerPrefix(backend)}:`)) {
		throw new AntigravityAcpError("auth", "Saved Google login belongs to a different authentication backend or CLI launcher. Run /login antigravity-acp.");
	}
	if (backend.kind === "standalone" && !hasSavedGoogleLogin()) {
		throw new AntigravityAcpError("auth", "No saved Google login for this Pi profile. Run /login antigravity-acp.");
	}
	// This is configuration presence, not proof of access. The CLI validates its
	// own cached credentials at session/new; Pi never reads its credential store.
	return marker;
}

export function hasSavedGoogleLogin(): boolean {
	return inspectAntigravityAuth(providerAcpDirectory(), {}).status === "oauth-refreshable";
}

export function credentialIdentity(apiKey: string | undefined): string {
	if (!apiKey) return "ambient";
	if (isGoogleLoginMarker(apiKey)) return apiKey;
	return `api-key:${createHash("sha256").update(apiKey).digest("hex")}`;
}
