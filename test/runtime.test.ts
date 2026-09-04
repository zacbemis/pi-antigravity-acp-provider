import type { Context, Model } from "@earendil-works/pi-ai";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import { GeminiAcpConnection } from "../src/acp/connection.js";
import {
	GeminiRuntime,
	PERMISSION_RESULT_KIND,
	PERMISSION_TOOL_NAME,
} from "../src/runtime.js";

const fakeAgent = fileURLToPath(new URL("./fixtures/fake-agent.mjs", import.meta.url));
const model: Model<"gemini-acp"> = {
	id: "gemini-test",
	name: "Gemini Test",
	api: "gemini-acp",
	provider: "gemini-acp",
	baseUrl: "",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1_000_000,
	maxTokens: 8_192,
};

describe("GeminiRuntime", () => {
	it("recognizes Gemini CLI's advertised Google login method", async () => {
		const runtime = new GeminiRuntime(
			(options) => new GeminiAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			await expect(runtime.loginGoogle()).resolves.toBeUndefined();
		} finally {
			await runtime.close();
		}
	});

	it("maps a complete ACP turn into balanced Pi events", async () => {
		const runtime = new GeminiRuntime(
			(options) => new GeminiAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			const context: Context = {
				systemPrompt: "Be useful",
				messages: [{ role: "user", content: "hello", timestamp: Date.now() }],
			};
			const writer = runtime.stream(model, context, { sessionId: "pi-session", apiKey: "test-key" });
			const events = [];
			for await (const event of writer.stream) events.push(event);
			expect(events.map((event) => event.type)).toEqual([
				"start",
				"thinking_start",
				"thinking_delta",
				"thinking_end",
				"text_start",
				"text_delta",
				"text_end",
				"done",
			]);
			const done = events.at(-1);
			expect(done).toMatchObject({
				type: "done",
				message: { usage: { input: 7, output: 3, totalTokens: 10 }, rawStopReason: "end_turn" },
			});
			const snapshot = await runtime.snapshot();
			expect(snapshot.bindings).toBe(1);
			expect(snapshot.processes[0]).toMatchObject({ modelId: "gemini-test", alive: true });
			if (done?.type !== "done") throw new Error("missing first turn");
			const switchedModel = { ...model, id: "auto", name: "Auto" };
			const second = runtime.stream(
				switchedModel,
				{
					messages: [
						...context.messages,
						done.message,
						{ role: "user", content: "second turn", timestamp: Date.now() },
					],
				},
				{ sessionId: "pi-session", apiKey: "test-key" },
			);
			for await (const _event of second.stream) void _event;
			const switched = await runtime.snapshot();
			expect(switched.processes[0]).toMatchObject({
				generation: snapshot.processes[0]?.generation,
				modelId: "auto",
			});
		} finally {
			await runtime.close();
		}
	});

	it("recreates the ACP session when the owned Pi prefix changes", async () => {
		const runtime = new GeminiRuntime(
			(options) => new GeminiAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			const first = runtime.stream(
				model,
				{ messages: [{ role: "user", content: "original", timestamp: 1 }] },
				{ sessionId: "rewind-session", apiKey: "test-key" },
			);
			for await (const _event of first.stream) void _event;
			const firstGeneration = (await runtime.snapshot()).processes[0]?.generation;

			const second = runtime.stream(
				model,
				{
					messages: [
						{ role: "user", content: "changed", timestamp: 1 },
						{ role: "user", content: "continue", timestamp: 2 },
					],
				},
				{ sessionId: "rewind-session", apiKey: "test-key" },
			);
			for await (const _event of second.stream) void _event;
			const secondGeneration = (await runtime.snapshot()).processes[0]?.generation;
			expect(secondGeneration).not.toBe(firstGeneration);
		} finally {
			await runtime.close();
		}
	});

	it("parks a permission request and resumes it from a Pi tool result", async () => {
		const runtime = new GeminiRuntime(
			(options) => new GeminiAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			const firstContext: Context = {
				messages: [{ role: "user", content: "request permission", timestamp: 1 }],
			};
			const firstWriter = runtime.stream(model, firstContext, {
				sessionId: "permission-session",
				apiKey: "test-key",
			});
			const firstEvents = [];
			for await (const event of firstWriter.stream) firstEvents.push(event);
			expect(firstEvents.map((event) => event.type)).toEqual([
				"start",
				"toolcall_start",
				"toolcall_delta",
				"toolcall_end",
				"done",
			]);
			const firstMessage = firstEvents.at(-1);
			if (firstMessage?.type !== "done") throw new Error("missing permission turn");
			const toolCall = firstMessage.message.content.find((block) => block.type === "toolCall");
			if (!toolCall || toolCall.type !== "toolCall") throw new Error("missing permission tool call");
			const request = runtime.getPermission(toolCall.id);
			expect(request?.options.map((option) => option.kind)).toEqual(["allow_once", "reject_once"]);

			const resumedContext: Context = {
				messages: [
					...firstContext.messages,
					firstMessage.message,
					{
						role: "toolResult",
						toolCallId: toolCall.id,
						toolName: PERMISSION_TOOL_NAME,
						content: [{ type: "text", text: "Rejected" }],
						details: {
							kind: PERMISSION_RESULT_KIND,
							requestId: toolCall.id,
							optionId: "reject-once",
							cancelled: false,
						},
						isError: false,
						timestamp: 2,
					},
				],
			};
			const secondWriter = runtime.stream(model, resumedContext, {
				sessionId: "permission-session",
				apiKey: "test-key",
			});
			const secondEvents = [];
			for await (const event of secondWriter.stream) secondEvents.push(event);
			expect(secondEvents.map((event) => event.type)).toEqual([
				"start",
				"text_start",
				"text_delta",
				"text_end",
				"done",
			]);
			expect(secondWriter.message.content).toEqual([{ type: "text", text: "Decision: selected" }]);
			expect(runtime.getPermission(toolCall.id)).toBeUndefined();
		} finally {
			await runtime.close();
		}
	});

	it("round-trips an MCP call through a genuine Pi tool call", async () => {
		const runtime = new GeminiRuntime(
			(options) => new GeminiAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			const tools = [
				{ name: "echo", description: "Echo text", parameters: Type.Object({ text: Type.String() }) },
			];
			const firstContext: Context = {
				messages: [{ role: "user", content: "use bridge", timestamp: 1 }],
				tools,
			};
			const firstWriter = runtime.stream(model, firstContext, { apiKey: "test-key" });
			const firstEvents = [];
			for await (const event of firstWriter.stream) firstEvents.push(event);
			const firstDone = firstEvents.at(-1);
			if (firstDone?.type !== "done") throw new Error("missing bridged tool turn");
			expect(firstDone.reason).toBe("toolUse");
			const call = firstDone.message.content.find((block) => block.type === "toolCall");
			if (!call || call.type !== "toolCall") throw new Error("missing bridged tool call");
			expect(call).toMatchObject({ name: "echo", arguments: { text: "from gemini" } });

			const secondWriter = runtime.stream(
				model,
				{
					tools,
					messages: [
						...firstContext.messages,
						firstDone.message,
						{
							role: "toolResult",
							toolCallId: call.id,
							toolName: call.name,
							content: [{ type: "text", text: "echo result" }],
							isError: false,
							timestamp: 2,
						},
					],
				},
				{ apiKey: "test-key" },
			);
			const secondEvents = [];
			for await (const event of secondWriter.stream) secondEvents.push(event);
			expect(secondWriter.message.content).toEqual([{ type: "text", text: "echo result" }]);
			expect(secondEvents.at(-1)?.type).toBe("done");
		} finally {
			await runtime.close();
		}
	});

	it("batches staggered parallel MCP calls into one Pi tool turn", async () => {
		const runtime = new GeminiRuntime(
			(options) => new GeminiAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			const tools = [
				{ name: "echo", description: "Echo text", parameters: Type.Object({ text: Type.String() }) },
			];
			const firstContext: Context = {
				tools,
				messages: [{ role: "user", content: "use bridge parallel", timestamp: 1 }],
			};
			const first = runtime.stream(model, firstContext, {
				sessionId: "parallel-session",
				apiKey: "test-key",
			});
			const firstEvents = [];
			for await (const event of first.stream) firstEvents.push(event);
			const firstDone = firstEvents.at(-1);
			if (firstDone?.type !== "done") throw new Error("missing parallel tool turn");
			const calls = firstDone.message.content.filter((block) => block.type === "toolCall");
			expect(calls.map((call) => call.arguments.text)).toEqual(["first", "second"]);

			const toolResults = calls.map((call, index) => ({
				role: "toolResult" as const,
				toolCallId: call.id,
				toolName: call.name,
				content: [{ type: "text" as const, text: `result-${index + 1}` }],
				isError: false,
				timestamp: index + 2,
			}));
			const second = runtime.stream(
				model,
				{
					tools,
					messages: [...firstContext.messages, firstDone.message, ...toolResults],
				},
				{ sessionId: "parallel-session", apiKey: "test-key" },
			);
			for await (const _event of second.stream) void _event;
			expect(second.message.content).toEqual([{ type: "text", text: "result-1,result-2" }]);
		} finally {
			await runtime.close();
		}
	});

	it("honors cancellation on an MCP continuation stream", async () => {
		const runtime = new GeminiRuntime(
			(options) => new GeminiAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			const tools = [
				{ name: "echo", description: "Echo text", parameters: Type.Object({ text: Type.String() }) },
			];
			const firstContext: Context = {
				tools,
				messages: [{ role: "user", content: "use bridge delayed", timestamp: 1 }],
			};
			const first = runtime.stream(model, firstContext, {
				sessionId: "continuation-abort",
				apiKey: "test-key",
			});
			const firstEvents = [];
			for await (const event of first.stream) firstEvents.push(event);
			const firstDone = firstEvents.at(-1);
			if (firstDone?.type !== "done") throw new Error("missing tool call turn");
			const call = firstDone.message.content.find((block) => block.type === "toolCall");
			if (!call || call.type !== "toolCall") throw new Error("missing tool call");

			const controller = new AbortController();
			const second = runtime.stream(
				model,
				{
					tools,
					messages: [
						...firstContext.messages,
						firstDone.message,
						{
							role: "toolResult",
							toolCallId: call.id,
							toolName: call.name,
							content: [{ type: "text", text: "result" }],
							isError: false,
							timestamp: 2,
						},
					],
				},
				{ sessionId: "continuation-abort", apiKey: "test-key", signal: controller.signal },
			);
			setTimeout(() => controller.abort(), 30);
			const secondEvents = [];
			for await (const event of second.stream) secondEvents.push(event);
			expect(secondEvents.at(-1)).toMatchObject({ type: "error", reason: "aborted" });
			expect((await runtime.snapshot()).processes[0]?.alive).toBe(true);
		} finally {
			await runtime.close();
		}
	});

	it("cancels an ACP prompt while preserving a healthy warm binding", async () => {
		const runtime = new GeminiRuntime(
			(options) => new GeminiAcpConnection({ ...options, command: process.execPath, args: [fakeAgent] }),
		);
		try {
			const controller = new AbortController();
			const writer = runtime.stream(
				model,
				{ messages: [{ role: "user", content: "hang", timestamp: 1 }] },
				{ sessionId: "abort-session", apiKey: "test-key", signal: controller.signal },
			);
			await runtime.snapshot();
			controller.abort();
			const events = [];
			for await (const event of writer.stream) events.push(event);
			expect(events.at(-1)).toMatchObject({ type: "error", reason: "aborted" });
			const snapshot = await runtime.snapshot();
			expect(snapshot.bindings).toBe(1);
			expect(snapshot.processes[0]?.alive).toBe(true);
		} finally {
			await runtime.close();
		}
	});
});
