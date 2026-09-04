export type AntigravityAcpErrorCode =
	| "aborted"
	| "auth"
	| "model"
	| "protocol"
	| "spawn"
	| "timeout"
	| "process_exit"
	| "invalid_input";

export class AntigravityAcpError extends Error {
	constructor(
		readonly code: AntigravityAcpErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "AntigravityAcpError";
	}
}

export function abortError(message = "Antigravity ACP request aborted"): AntigravityAcpError {
	return new AntigravityAcpError("aborted", message);
}

export function errorMessage(cause: unknown): string {
	if (cause instanceof Error && cause.message) return redact(cause.message);
	return redact(String(cause));
}

export function redact(text: string): string {
	return text
		.replace(/(?:AIza|sk-)[A-Za-z0-9_-]{12,}/gu, "<redacted>")
		.replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,;]+/giu, "$1<redacted>")
		.slice(0, 4_096);
}
