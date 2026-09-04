import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { resolveBundledGeminiEntry } from "../src/acp/process.js";
import {
	ACP_PROTOCOL_VERSION,
	ACP_SDK_VERSION,
	ANTIGRAVITY_ACP_VERSION,
	PACKAGE_VERSION,
} from "../src/constants.js";
import { createGeminiProvider } from "../src/provider.js";
import {
	PERMISSION_RESULT_KIND,
	PERMISSION_TOOL_NAME,
	type PermissionToolResult,
} from "../src/runtime.js";

export default function geminiAcpExtension(pi: ExtensionAPI): void {
	const { provider, runtime } = createGeminiProvider();
	pi.registerProvider(provider);

	pi.registerTool({
		name: PERMISSION_TOOL_NAME,
		label: "Gemini ACP Permission",
		description: "Presents an Antigravity ACP permission request to the user. Only call IDs emitted by the provider are valid.",
		parameters: Type.Object({ requestId: Type.String({ minLength: 1, maxLength: 128 }) }),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const request = runtime.getPermission(params.requestId);
			if (!request) throw new Error("This Gemini permission request is missing, expired, or already used");
			const labels = request.options.map(
				(option, index) => `${index + 1}. ${option.label} [${option.kind.replaceAll("_", " ")}]`,
			);
			let selected: string | undefined;
			try {
				selected = await ctx.ui.select(request.title, labels);
			} catch {
				// Print/RPC/headless modes deny when no interactive selector is available.
			}
			const selectedIndex = selected === undefined ? -1 : labels.indexOf(selected);
			const optionId = selectedIndex < 0 ? undefined : request.options[selectedIndex]?.id;
			const details: PermissionToolResult = {
				kind: PERMISSION_RESULT_KIND,
				requestId: request.id,
				...(optionId === undefined ? {} : { optionId }),
				cancelled: optionId === undefined,
			};
			return {
				content: [
					{
						type: "text",
						text: optionId === undefined ? "Permission denied." : `Permission decision recorded: ${selected}`,
					},
				],
				details,
			};
		},
	});

	pi.registerCommand("gemini-acp", {
		description: "Show Gemini ACP provider status (usage: /gemini-acp doctor [--verbose])",
		handler: async (args, ctx) => {
			const command = args.trim() || "doctor";
			const verbose = command === "doctor --verbose";
			if (command !== "doctor" && command !== "status" && !verbose) {
				ctx.ui.notify("Usage: /gemini-acp doctor [--verbose]", "warning");
				return;
			}
			let entry: string;
			try {
				entry = resolveBundledGeminiEntry();
			} catch (error) {
				entry = error instanceof Error ? error.message : String(error);
			}
			const snapshot = await runtime.snapshot(verbose);
			ctx.ui.notify(
				[
					`Gemini ACP provider ${PACKAGE_VERSION}`,
					`Runtime: Antigravity ACP ${ANTIGRAVITY_ACP_VERSION}, ACP SDK ${ACP_SDK_VERSION}, protocol ${ACP_PROTOCOL_VERSION}`,
					`Antigravity server: ${entry}`,
					`Active bindings: ${snapshot.bindings}`,
					...snapshot.processes.flatMap((item) => [
						`• pid=${item.pid ?? "?"} generation=${item.generation} model=${item.modelId} alive=${item.alive} agent=${item.agentVersion ?? "?"} mcpHttp=${item.mcpHttp} permission=${item.waitingForPermission} tools=${item.waitingForTools}`,
						...(verbose && item.stderrTail ? [`  stderr (redacted): ${item.stderrTail}`] : []),
					]),
				].join("\n"),
				"info",
			);
		},
	});

	pi.on("session_shutdown", async () => {
		await runtime.close();
	});
}
