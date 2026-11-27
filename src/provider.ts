import type {
	Api,
	ApiStreamOptions,
	AssistantMessageEventStream,
	TranscriptContext,
	Model,
	Provider,
	RefreshModelsContext,
	SimpleStreamOptions,
} from "@earendil-works/pi-ai";

import { authenticationBackend } from "./acp/auth-backend.js";
import { newGoogleLoginMarker, savedGoogleLogin } from "./auth.js";
import { FALLBACK_MODELS, modelForAcpStream, projectModels, PROVIDER_ID, restoreModels } from "./models.js";
import { AntigravityRuntime } from "./runtime.js";

export interface AntigravityProviderBundle {
	provider: Provider<"antigravity-acp">;
	runtime: AntigravityRuntime;
}

export function createAntigravityProvider(runtime = new AntigravityRuntime()): AntigravityProviderBundle {
	let models = [...FALLBACK_MODELS];
	const provider: Provider<"antigravity-acp"> = {
		id: PROVIDER_ID,
		name: "Google Antigravity (ACP)",
		auth: {
			oauth: {
				name: "Google Antigravity (ACP)",
				loginLabel: "Sign in with Google",
				async login(interaction) {
					interaction.notify({ type: "progress", message: authenticationBackend().kind === "cli"
						? "Validating the Antigravity CLI's cached Google login…"
						: "Starting Antigravity Google login…" });
					await runtime.loginGoogle(
						interaction.signal,
						(message) => interaction.notify({ type: "progress", message }),
						{
							showAuthorizationUrl(url, instructions) {
								interaction.notify({
									type: "info",
									message: instructions,
									links: [{ url, label: "Google authorization" }],
								});
							},
							promptForCallback: (signal) =>
								interaction.prompt({
									type: "manual_code",
									message: "Paste the final localhost callback URL (or authorization code):",
									placeholder: "http://127.0.0.1:PORT/?state=…&code=…",
									signal,
								}),
						},
					);
					const marker = newGoogleLoginMarker();
					return {
						type: "oauth",
						// The marker identifies the login without copying Google's tokens into Pi's auth store.
						refresh: marker,
						access: marker,
						expires: Number.MAX_SAFE_INTEGER,
					};
				},
				async refresh(credential) {
					return credential;
				},
				async toAuth(credential) {
					return { apiKey: savedGoogleLogin(credential.access) };
				},
			},
			apiKey: {
				name: "Antigravity Gemini API key",
				async login(interaction) {
					if (authenticationBackend().kind === "cli") {
						throw new Error("The CLI backend uses its cached Google login. Choose Sign in with Google instead of API key.");
					}
					const key = await interaction.prompt({
						type: "secret",
						message: "Gemini API key",
						placeholder: "AIza…",
					});
					if (!key.trim()) throw new Error("Gemini API key is required");
					interaction.notify({ type: "progress", message: "Verifying Gemini API key…" });
					await runtime.verifyApiKey(key.trim(), interaction.signal, (message) =>
						interaction.notify({ type: "progress", message }),
					);
					return { type: "api_key", key: key.trim() };
				},
				async check({ ctx, credential }) {
					if (authenticationBackend().kind === "cli") return undefined;
					if (credential?.key) return { type: "api_key", source: "Pi auth store" };
					if (await ctx.env("GEMINI_API_KEY")) return { type: "api_key", source: "GEMINI_API_KEY" };
					return undefined;
				},
				async resolve({ ctx, credential }) {
					if (authenticationBackend().kind === "cli") return undefined;
					const key = credential?.key ?? (await ctx.env("GEMINI_API_KEY"));
					if (key) {
						return {
							auth: { apiKey: key },
							source: credential?.key ? "Pi auth store" : "GEMINI_API_KEY",
						};
					}
					return undefined;
				},
			},
		},
		getModels: () => models,
		async refreshModels(context: RefreshModelsContext) {
			if (!context.allowNetwork) {
				// Restore the last discovered catalog before Pi resolves startup model
				// patterns, so models outside the offline fallback stay selectable.
				const restored = restoreModels(context.stored?.models ?? []);
				if (restored.length === 0) return;
				await context.publish({
					update: () => {
						models = restored;
					},
				});
				return;
			}
			let discovered;
			try {
				const key =
					context.credential?.type === "oauth"
						? savedGoogleLogin(context.credential.access)
						: context.credential?.type === "api_key"
							? context.credential.key
							: authenticationBackend().kind === "standalone" ? process.env.GEMINI_API_KEY?.trim() : undefined;
				if (!key) return;
				discovered = projectModels(await runtime.discoverModels(key, context.signal));
			} catch {
				// Startup refresh must not hide the conservative offline catalog when
				// authentication is absent, expired, or temporarily unavailable.
				return;
			}
			if (discovered.length === 0) return;
			await context.publish({
				persist: { models: discovered, checkedAt: Date.now() },
				update: () => {
					models = discovered;
				},
			});
		},
		stream(model, context, options) {
			return stream(runtime, modelForAcpStream(model, models), context, options);
		},
		streamSimple(model, context, options) {
			return stream(runtime, modelForAcpStream(model, models), context, options);
		},
	};
	return { provider, runtime };
}

function stream(
	runtime: AntigravityRuntime,
	model: Model<"antigravity-acp">,
	context: TranscriptContext,
	options: ApiStreamOptions<"antigravity-acp"> | SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
	return runtime.stream(model, context, options as SimpleStreamOptions | undefined).stream;
}

export const ANTIGRAVITY_ACP_API = "antigravity-acp" satisfies Api;
