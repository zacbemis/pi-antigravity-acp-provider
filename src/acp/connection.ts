import {
	ClientSideConnection,
	PROTOCOL_VERSION,
	RequestError,
	type AuthenticateRequest,
	type InitializeResponse,
	type McpServer,
	type NewSessionResponse,
	type PromptRequest,
	type PromptResponse,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
} from "@agentclientprotocol/sdk";

import { PACKAGE_VERSION } from "../constants.js";
import { boundedNdjsonStream } from "./bounded-stream.js";
import { abortError, GeminiAcpError } from "./errors.js";
import { GeminiProcess, type GeminiProcessOptions } from "./process.js";

export interface GeminiConnectionHandlers {
	onUpdate?: (notification: SessionNotification) => void | Promise<void>;
	onPermission?: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
}

export interface GeminiConnectionOptions extends GeminiProcessOptions {
	handlers?: GeminiConnectionHandlers;
	initializeTimeoutMs?: number;
	operationTimeoutMs?: number;
	maxFrameBytes?: number;
}

export class GeminiAcpConnection {
	readonly process: GeminiProcess;
	readonly initialized: Promise<InitializeResponse>;
	private readonly connection: ClientSideConnection;
	private readonly operationTimeoutMs: number;
	private handlers: GeminiConnectionHandlers;
	private closePromise?: Promise<void>;

	constructor(options: GeminiConnectionOptions) {
		this.handlers = options.handlers ?? {};
		this.operationTimeoutMs = options.operationTimeoutMs ?? 30_000;
		this.process = new GeminiProcess(options);
		const stream = boundedNdjsonStream(this.process.output, this.process.input, {
			...(options.maxFrameBytes === undefined ? {} : { maxFrameBytes: options.maxFrameBytes }),
			onProtocolError: () => void this.process.close(),
		});
		this.connection = new ClientSideConnection(
			() => ({
				requestPermission: async (request) =>
					this.handlers.onPermission?.(request) ?? { outcome: { outcome: "cancelled" } },
				sessionUpdate: async (notification) => {
					await this.handlers.onUpdate?.(notification);
				},
			}),
			stream,
		);
		this.initialized = this.withDeadline(
			this.connection.initialize({
				protocolVersion: PROTOCOL_VERSION,
				clientCapabilities: {
					fs: { readTextFile: false, writeTextFile: false },
					terminal: false,
				},
				clientInfo: {
					name: "pi-gemini-acp-provider",
					title: "Pi Gemini ACP Provider",
					version: PACKAGE_VERSION,
				},
			}),
			options.initializeTimeoutMs ?? 30_000,
			"initialize",
		);
	}

	setHandlers(handlers: GeminiConnectionHandlers): void {
		this.handlers = handlers;
	}

	async initialize(): Promise<InitializeResponse> {
		const response = await this.initialized;
		if (response.protocolVersion !== PROTOCOL_VERSION) {
			await this.close();
			throw new GeminiAcpError(
				"protocol",
				`Unsupported ACP protocol version ${String(response.protocolVersion)}`,
			);
		}
		return response;
	}

	async authenticate(request: AuthenticateRequest, signal?: AbortSignal): Promise<void> {
		await this.initialize();
		await this.withAbort(
			this.withDeadline(this.connection.authenticate(request), 180_000, "authenticate"),
			signal,
		);
	}

	async newSession(
		cwd: string,
		signal?: AbortSignal,
		mcpServers: McpServer[] = [],
	): Promise<NewSessionResponse> {
		await this.initialize();
		return this.withAbort(
			this.withDeadline(
				this.connection.newSession({ cwd, mcpServers }),
				this.operationTimeoutMs,
				"session/new",
			),
			signal,
		);
	}

	async setModel(sessionId: string, modelId: string, signal?: AbortSignal): Promise<void> {
		await this.withAbort(
			this.withDeadline(
				this.connection.unstable_setSessionModel({ sessionId, modelId }),
				this.operationTimeoutMs,
				"session/set_model",
			),
			signal,
		);
	}

	async prompt(request: PromptRequest, signal?: AbortSignal): Promise<PromptResponse> {
		if (signal?.aborted) throw abortError();
		const pending = this.connection.prompt(request);
		if (!signal) return this.withDeadline(pending, 10 * 60_000, "session/prompt");

		return new Promise<PromptResponse>((resolve, reject) => {
			let settled = false;
			let aborting = false;
			let cancelTimer: ReturnType<typeof setTimeout> | undefined;
			const finish = (callback: () => void) => {
				if (settled) return;
				settled = true;
				if (cancelTimer) clearTimeout(cancelTimer);
				signal.removeEventListener("abort", onAbort);
				callback();
			};
			const onAbort = () => {
				if (aborting) return;
				aborting = true;
				void this.cancel(request.sessionId);
				cancelTimer = setTimeout(() => {
					void this.close().finally(() => finish(() => reject(abortError())));
				}, 1_500);
			};
			signal.addEventListener("abort", onAbort, { once: true });
			this.withDeadline(pending, 10 * 60_000, "session/prompt").then(
				(value) => {
					if (aborting) finish(() => reject(abortError()));
					else finish(() => resolve(value));
				},
				(error: unknown) => finish(() => reject(aborting ? abortError() : error)),
			);
		});
	}

	async cancel(sessionId: string): Promise<void> {
		await this.connection.cancel({ sessionId });
	}

	async close(): Promise<void> {
		this.closePromise ??= this.process.close();
		await this.closePromise;
	}

	private async withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
		if (!signal) return promise;
		if (signal.aborted) {
			await this.close();
			throw abortError();
		}
		return new Promise<T>((resolve, reject) => {
			const abort = () => {
				void this.close();
				reject(abortError());
			};
			signal.addEventListener("abort", abort, { once: true });
			promise.then(
				(value) => {
					signal.removeEventListener("abort", abort);
					resolve(value);
				},
				(error: unknown) => {
					signal.removeEventListener("abort", abort);
					reject(classifyError(error));
				},
			);
		});
	}

	private async withDeadline<T>(promise: Promise<T>, timeoutMs: number, phase: string): Promise<T> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				promise.catch((error: unknown) => {
					throw classifyError(error);
				}),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => {
						void this.close();
						reject(new GeminiAcpError("timeout", `Gemini ACP ${phase} timed out after ${timeoutMs}ms`));
					}, timeoutMs);
					timer.unref?.();
				}),
			]);
		} finally {
			if (timer) clearTimeout(timer);
		}
	}
}

function classifyError(error: unknown): Error {
	if (error instanceof GeminiAcpError) return error;
	const structured =
		error instanceof RequestError
			? error
			: error &&
				  typeof error === "object" &&
				  typeof (error as { code?: unknown }).code === "number" &&
				  typeof (error as { message?: unknown }).message === "string"
				? (error as { code: number; message: string })
				: undefined;
	if (structured) {
		if (structured.code === -32000) {
			return new GeminiAcpError("auth", `Gemini authentication required: ${structured.message}`, {
				cause: error,
			});
		}
		return new GeminiAcpError("protocol", `Gemini ACP error ${structured.code}: ${structured.message}`, {
			cause: error,
		});
	}
	return error instanceof Error ? error : new Error(String(error));
}
