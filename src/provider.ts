import type {
	Api,
	ApiStreamOptions,
	AssistantMessageEventStream,
	Context,
	Model,
	Provider,
	RefreshModelsContext,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { FALLBACK_MODELS, projectModels, PROVIDER_ID } from "./models.js";
import { GeminiRuntime, MANAGED_AUTH_MARKER } from "./runtime.js";

export interface GeminiProviderBundle {
	provider: Provider<"gemini-acp">;
	runtime: GeminiRuntime;
}

export function createGeminiProvider(runtime = new GeminiRuntime()): GeminiProviderBundle {
	let models = [...FALLBACK_MODELS];
	const provider: Provider<"gemini-acp"> = {
		id: PROVIDER_ID,
		name: "Google Antigravity (ACP)",
		auth: {
			oauth: {
				name: "Google Antigravity (ACP)",
				loginLabel: "Sign in with Google",
				async login(interaction) {
					interaction.notify({ type: "progress", message: "Starting Antigravity Google login…" });
					await runtime.loginGoogle(interaction.signal);
					return {
						type: "oauth",
						// Pi needs a durable credential record so the provider stays visible;
						// the actual OAuth tokens remain owned by Google Antigravity.
						refresh: MANAGED_AUTH_MARKER,
						access: MANAGED_AUTH_MARKER,
						expires: Number.MAX_SAFE_INTEGER,
					};
				},
				async refresh(credential) {
					return credential;
				},
				async toAuth() {
					return { apiKey: MANAGED_AUTH_MARKER };
				},
			},
			apiKey: {
				name: "Antigravity Gemini API key",
				async login(interaction) {
					const key = await interaction.prompt({
						type: "secret",
						message: "Gemini API key",
						placeholder: "AIza…",
					});
					if (!key.trim()) throw new Error("Gemini API key is required");
					interaction.notify({ type: "progress", message: "Verifying Gemini API key…" });
					await runtime.verifyApiKey(key.trim(), interaction.signal);
					return { type: "api_key", key: key.trim() };
				},
				async check({ ctx, credential }) {
					if (credential?.key) return { type: "api_key", source: "Pi auth store" };
					if (await ctx.env("GEMINI_API_KEY")) return { type: "api_key", source: "GEMINI_API_KEY" };
					if (
						(await ctx.fileExists("~/.gemini/antigravity-acp/acp_token.json")) ||
						(await ctx.fileExists("~/.gemini/antigravity-acp/settings.json"))
					) {
						return { type: "api_key", source: "Antigravity ACP" };
					}
					return undefined;
				},
				async resolve({ ctx, credential }) {
					const key = credential?.key ?? (await ctx.env("GEMINI_API_KEY"));
					if (key) {
						return {
							auth: { apiKey: key },
							source: credential?.key ? "Pi auth store" : "GEMINI_API_KEY",
						};
					}
					if (
						(await ctx.fileExists("~/.gemini/antigravity-acp/acp_token.json")) ||
						(await ctx.fileExists("~/.gemini/antigravity-acp/settings.json"))
					) {
						return { auth: { apiKey: MANAGED_AUTH_MARKER }, source: "Antigravity ACP" };
					}
					return undefined;
				},
			},
		},
		getModels: () => models,
		async refreshModels(context: RefreshModelsContext) {
			if (!context.allowNetwork) return;
			const key =
				context.credential?.type === "api_key"
					? context.credential.key
					: context.credential?.type === "oauth"
						? MANAGED_AUTH_MARKER
						: undefined;
			let discovered;
			try {
				discovered = projectModels(await runtime.discoverModels(key, context.signal));
			} catch {
				// Startup refresh must not hide the conservative offline catalog when
				// authentication is absent, expired, or temporarily unavailable.
				return;
			}
			if (discovered.length === 0) return;
			await context.publish({
				update: () => {
					models = discovered;
				},
			});
		},
		stream(model, context, options) {
			return stream(runtime, model, context, options);
		},
		streamSimple(model, context, options) {
			return stream(runtime, model, context, options);
		},
	};
	return { provider, runtime };
}

function stream(
	runtime: GeminiRuntime,
	model: Model<"gemini-acp">,
	context: Context,
	options: ApiStreamOptions<"gemini-acp"> | SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
	return runtime.stream(model, context, options as SimpleStreamOptions | undefined).stream;
}

export const GEMINI_ACP_API = "gemini-acp" satisfies Api;
