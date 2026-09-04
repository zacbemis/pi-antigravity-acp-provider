import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { resolveBundledGeminiEntry } from "../src/acp/process.js";
import {
	isPermissionMode,
	loadConfig,
	permissionModeLabel,
	savePermissionMode,
	type PermissionMode,
} from "../src/config.js";
import {
	ACP_PROTOCOL_VERSION,
	ACP_SDK_VERSION,
	ANTIGRAVITY_ACP_VERSION,
	PACKAGE_VERSION,
} from "../src/constants.js";
import { createGeminiProvider } from "../src/provider.js";
import {
	GeminiRuntime,
	PERMISSION_RESULT_KIND,
	PERMISSION_TOOL_NAME,
	type PermissionToolResult,
} from "../src/runtime.js";

export default function geminiAcpExtension(pi: ExtensionAPI): void {
	const runtime = new GeminiRuntime(undefined, loadConfig().permissions);
	const { provider } = createGeminiProvider(runtime);
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
		description: "Configure Antigravity permissions or show provider status",
		handler: async (args, ctx) => {
			const command = args.trim() || "doctor";
			if (command === "permissions" || command.startsWith("permissions ")) {
				let requested = command.slice("permissions".length).trim().replaceAll("-", "_");
				if (!requested) {
					const choices = [
						"yolo — allow commands and edits automatically (default)",
						"auto-edit — allow edits automatically; commands may ask",
						"default — ask before sensitive operations",
					];
					const selected = await ctx.ui.select("Antigravity permission mode", choices);
					if (!selected) return;
					requested = selected.split(" ", 1)[0]!.replaceAll("-", "_");
				}
				if (!isPermissionMode(requested)) {
					ctx.ui.notify(
						"Usage: /gemini-acp permissions [default|auto-edit|yolo]",
						"warning",
					);
					return;
				}
				const mode: PermissionMode = requested;
				await runtime.setPermissionMode(mode);
				savePermissionMode(mode);
				ctx.ui.notify(
					mode === "yolo"
						? "Antigravity permission mode: yolo. Commands and edits may run without confirmation."
						: `Antigravity permission mode: ${permissionModeLabel(mode)}.`,
					mode === "yolo" ? "warning" : "info",
				);
				return;
			}
			const verbose = command === "doctor --verbose";
			if (command !== "doctor" && command !== "status" && !verbose) {
				ctx.ui.notify(
					"Usage: /gemini-acp doctor [--verbose] | permissions [default|auto-edit|yolo]",
					"warning",
				);
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
					`Permission mode: ${permissionModeLabel(snapshot.permissionMode)}`,
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
