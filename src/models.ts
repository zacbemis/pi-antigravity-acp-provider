import type { Model } from "@earendil-works/pi-ai";
import type { ModelInfo } from "@agentclientprotocol/sdk";

export const PROVIDER_ID = "gemini-acp";
export const API_ID = "gemini-acp";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } as const;

export const FALLBACK_MODELS: readonly Model<typeof API_ID>[] = [
	model("gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"),
	model("gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)"),
	model("gemini-3.8-flash-low", "Gemini 3.8 Flash (Low)"),
	model("gemini-3.7-flash-high", "Gemini 3.7 Flash (High)"),
	model("gemini-3.7-flash-medium", "Gemini 3.7 Flash (Medium)"),
	model("gemini-3.7-flash-low", "Gemini 3.7 Flash (Low)"),
	model("gemini-3.6-flash-high", "Gemini 3.6 Flash (High)"),
	model("gemini-3.6-flash-medium", "Gemini 3.6 Flash (Medium)"),
	model("gemini-3.6-flash-low", "Gemini 3.6 Flash (Low)"),
	model("gemini-pro-agent", "Gemini 3.1 Pro (High)"),
	model("gemini-3.1-pro-low", "Gemini 3.1 Pro (Low)"),
];

export function projectModels(models: readonly ModelInfo[]): Model<typeof API_ID>[] {
	const seen = new Set<string>();
	const projected: Model<typeof API_ID>[] = [];
	for (const candidate of models) {
		const id = candidate.modelId.trim();
		if (!validModelId(id) || seen.has(id)) continue;
		seen.add(id);
		projected.push(model(id, candidate.name.trim() || id));
	}
	return projected;
}

function model(id: string, name: string): Model<typeof API_ID> {
	return {
		id,
		name,
		api: API_ID,
		provider: PROVIDER_ID,
		baseUrl: "",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 65_536,
	};
}

function validModelId(id: string): boolean {
	return id.length > 0 && id.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(id);
}
