import type { CreateElicitationRequest, CreateElicitationResponse, ElicitationSchema } from "@agentclientprotocol/sdk/unstable";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Value } from "typebox/value";

export interface QuestionForm {
	message: string;
	schema: ElicitationSchema;
}

export function elicitationForm(request: CreateElicitationRequest): QuestionForm | undefined {
	if (request.mode !== "form" || !("requestedSchema" in request)) return undefined;
	const schema = request.requestedSchema as ElicitationSchema;
	if (!schema || typeof schema !== "object" || !schema.properties) return undefined;
	return { message: request.message, schema: { ...schema, type: "object" } };
}

export function elicitationResult(form: QuestionForm, result: CallToolResult): CreateElicitationResponse {
	if (result.isError) return { action: "cancel" };
	try {
		const text = result.content.find((block) => block.type === "text");
		if (text?.type !== "text") return { action: "cancel" };
		const response = JSON.parse(text.text) as CreateElicitationResponse;
		if (response.action === "decline" || response.action === "cancel") return { action: response.action };
		if (response.action === "accept" && Value.Check(form.schema, response.content)) {
			return { action: "accept", content: response.content };
		}
	} catch {
		// A blocked, malformed or stale Pi result must release the pending question.
	}
	return { action: "cancel" };
}
