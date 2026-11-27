import fs from "node:fs";
import readline from "node:readline";

// A real JSON-RPC child process: selector updates can be ignored, partially
// applied, or fail in transport, independently of provider-side cached state.
const scenario = process.argv[2] ?? "split";
// ACP 1.5.2 lists every model's exact IDs, while the thought selector offers
// only the current model's levels and rejects any other.
const ladders = scenario === "per-model" ? {
	"gemini-4-neon": ["low", "medium", "high", "xhigh"],
	"gemini-4-carbon": ["low", "medium", "high"],
	"gemini-3.8-flash": ["low", "medium", "high"],
} : undefined;
const title = (id) => id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
const listed = () => Object.entries(ladders ?? {}).flatMap(([base, levels]) =>
	levels.map((level) => ({ modelId: `${base}-${level}`, name: `${title(base)} (${level === "xhigh" ? "XHigh" : title(level)})` })));
let model = ladders ? "gemini-3.8-flash" : "gemini-a";
let effort = "high";
let mode = "default";
const legacy = scenario.startsWith("legacy");
const thoughtId = scenario === "category-only" ? "custom-thinking" :
	scenario === "thought-alias" ? "thought_level" : "thinking_level";
const values = (ids) => ids.map((value) => ({ value, name: value }));
const levels = () => ladders?.[model] ?? ["off", "low", "medium", "high"];
const modelIds = ladders ? Object.keys(ladders) : ["gemini-a", "gemini-b", ...(scenario === "native-id" ? ["gemini-a-low"] : []),
	...(scenario === "new-gemini-4" ? ["gemini-4-test"] : [])];
const configOptions = () => [
	{ id: "model", name: "Model", category: "model", type: "select", currentValue: model,
		options: [{ group: "google", name: "Google", options: values(modelIds) }] },
	...(!legacy && !(scenario === "disappearing" && model === "gemini-b") ? [{
		id: thoughtId, name: "Thinking", type: "select", currentValue: effort,
		...(["thinking-alias", "thought-alias"].includes(scenario) ? {} : { category: "thought_level" }),
		options: [{ group: "levels", name: "Levels", options: values(levels()) }],
	}] : []),
	{ id: "mode", name: "Mode", category: "mode", type: "select", currentValue: mode,
		options: values(["default", "auto_edit", "yolo"]) },
];
const sessionState = () => ({ configOptions: configOptions(),
	...(ladders ? { models: { currentModelId: `${model}-${effort}`, availableModels: listed() } } : {}) });
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
for await (const line of readline.createInterface({ input: process.stdin })) {
	const { id, method, params } = JSON.parse(line);
	if (id === undefined) continue;
	if (process.env.MODEL_SELECTION_AGENT_LOG_FILE) fs.appendFileSync(process.env.MODEL_SELECTION_AGENT_LOG_FILE,
		`${JSON.stringify({ method, ...(method === "session/set_config_option" ? { configId: params.configId, value: params.value } : {}) })}\n`);
	if (method === "initialize") {
		reply(id, { protocolVersion: 1, agentInfo: { name: "model-selection-agent" },
			authMethods: [{ id: "api", name: "Gemini API key" }],
			agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } } });
	} else if (method === "authenticate") {
		reply(id, {});
	} else if (method === "session/new") {
		reply(id, { sessionId: "selection-session", ...sessionState() });
	} else if (method === "session/resume" || method === "session/load") {
		reply(id, sessionState());
	} else if (method === "session/set_config_option") {
		if (["selector-auth", "selector-protocol"].includes(scenario)) {
			send({ jsonrpc: "2.0", id, error: { code: scenario === "selector-auth" ? -32000 : -32602, message: "Selector update rejected" } });
			continue;
		}
		if (params.configId === "model" && modelIds.includes(params.value)) {
			if (scenario !== "ignored-base") {
				model = params.value;
				if (ladders && !levels().includes(effort)) effort = "high";
			}
		} else if (params.configId === thoughtId) {
			if (ladders && !levels().includes(params.value)) {
				send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Thinking level "${params.value}" is not offered for model "${model}"` } });
				continue;
			}
			if (!(scenario === "reject-low" && params.value === "low")) effort = params.value;
			if (scenario === "model-drift") model = "gemini-a";
		} else if (params.configId === "mode") mode = params.value;
		reply(id, { configOptions: configOptions() });
	} else if (method === "session/set_model") {
		if (scenario === "legacy-auth") {
			send({ jsonrpc: "2.0", id, error: { code: -32000, message: "Token expired" } });
		} else if (scenario === "legacy-timeout") {
			continue;
		} else if (scenario === "legacy-exit") {
			process.stderr.write("selection transport exited\n");
			process.exit(7);
		} else if (legacy || scenario === "ignored-base") {
			model = params.modelId;
			reply(id, {});
		} else {
			send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Draft model method unavailable" } });
		}
	} else if (method === "session/prompt") {
		send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params.sessionId,
			update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${model}/${effort}` } } } });
		reply(id, { stopReason: "end_turn" });
	} else {
		send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${method}` } });
	}
}
