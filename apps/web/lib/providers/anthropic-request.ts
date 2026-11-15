import type Anthropic from "@anthropic-ai/sdk";
import type { AiCreateParams, AiResponse } from "./index";
import { completionEvidence } from "./request-evidence";
import { splitSystemForCache, type CacheTtl } from "./system-cache";
import { resolveThinking, resolveThinkingOverride } from "./thinking";
import { stripLoneSurrogates } from "./sanitize";
import { VALID_EFFORTS } from "./thinking";

export const usesNativeJsonOutput = (model: string) => model === "claude-opus-5-5" || model === "claude-sonnet-5-5";

// SDK 0.91.1 predates Sonnet 5.5's between_tools mode. Keep its other fields typed.
export type AnthropicRequest = Omit<Anthropic.MessageCreateParamsStreaming, "thinking"> & {
  thinking?: Anthropic.ThinkingConfigParam | { type: "between_tools" };
};

/** One adapter transformation for ordinary generation and measured complete reviews. */
export function prepareAnthropicRequest(params: AiCreateParams, cacheTtl: CacheTtl): AnthropicRequest {
  const nativeJson = usesNativeJsonOutput(params.model) && params.responseSchema !== undefined;
  const useTool = params.responseSchema !== undefined && !nativeJson;
  const { maxTokens, thinking, outputConfig } = resolveThinking(params.model, params.maxTokens, useTool, params.effort);
  const thinkingParam = resolveThinkingOverride(params.model, params.thinking, thinking);
  // between_tools rejects xhigh/max; preserve the caller's no-upfront-thinking
  // intent while using the highest effort supported by that mode.
  if (thinkingParam?.type === "between_tools" && outputConfig
    && (outputConfig.effort === "xhigh" || outputConfig.effort === "max")) outputConfig.effort = "high";
  return {
    model: params.model, max_tokens: maxTokens,
    // MessageStream adds this before SDK create; include it in the admitted digest.
    stream: true,
    ...(thinkingParam ? { thinking: thinkingParam } : {}),
    ...((outputConfig || nativeJson) ? { output_config: { ...outputConfig, ...(nativeJson ? { format: { type: "json_schema" as const, schema: params.responseSchema!.schema } } : {}) } } : {}),
    system: params.system ? splitSystemForCache(stripLoneSurrogates(params.system), params.cacheSystem, cacheTtl) : undefined,
    messages: params.messages.map(message => ({ role: message.role, content: stripLoneSurrogates(message.content) })),
    ...(useTool ? {
      tools: [{ name: params.responseSchema!.name,
        description: `Return the response as a ${params.responseSchema!.name} object.`,
        input_schema: params.responseSchema!.schema as Anthropic.Tool.InputSchema }],
      tool_choice: { type: "tool" as const, name: params.responseSchema!.name },
    } : {}),
  };
}

/** Freeze the serialized body that both count projection and generation consume. */
export function freezeRequest<T>(body: T): T {
  const freeze = (value: unknown): void => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  const serialized: T = JSON.parse(JSON.stringify(body));
  freeze(serialized);
  return serialized;
}

/** The installed SDK count endpoint accepts these input fields; no other field may disappear. */
export function anthropicCountProjection(body: AnthropicRequest): Anthropic.MessageCountTokensParams | null {
  const supported = new Set(["model", "messages", "system", "thinking", "output_config", "max_tokens", "stream"]);
  if (Object.keys(body).some(key => !supported.has(key))) return null;
  const only = (value: object, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
  if (body.stream !== true || !Array.isArray(body.messages) || body.messages.some(message => !message
    || !only(message, ["role", "content"]) || !["user", "assistant"].includes(message.role) || typeof message.content !== "string")) return null;
  if (body.system !== undefined && (!Array.isArray(body.system) || body.system.some(block => !block
    || !only(block, ["type", "text", "cache_control"]) || block.type !== "text" || typeof block.text !== "string"
    || (block.cache_control && (!only(block.cache_control, ["type", "ttl"]) || block.cache_control.type !== "ephemeral"
      || !["5m", "1h"].includes(block.cache_control.ttl ?? "5m")))))) return null;
  if (!body.thinking || !only(body.thinking, ["type"]) || body.thinking.type !== "adaptive"
    || !body.output_config || !only(body.output_config, ["effort"])
    || !VALID_EFFORTS.includes(body.output_config.effort as typeof VALID_EFFORTS[number])) return null;
  const { max_tokens: _maxTokens, stream: _stream, ...input } = body;
  return { ...input, thinking: body.thinking };
}

/** Map a finished Messages response to text, completion and usage. Shared by the Anthropic and Bedrock adapters. */
export function readAnthropicMessage(response: Anthropic.Message, useTool: boolean): Pick<AiResponse, "text" | "completion" | "usage"> {
  let text: string;
  if (useTool) {
    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      throw Object.assign(new Error(
        `Anthropic returned no tool_use (stop_reason: ${response.stop_reason}, blocks: ${response.content.map((b) => b.type).join(",") || "none"})`,
      ), response.stop_reason === "refusal" ? { code: "PROVIDER_REFUSAL" } : {});
    }
    text = JSON.stringify(toolUse.input);
    if (!text || text === "{}") {
      throw new Error(
        `Anthropic returned empty structured output (stop_reason: ${response.stop_reason})`,
      );
    }
  } else {
    // Models with extended thinking (e.g. claude-fable-5) prepend a thinking
    // block, so the text block is not necessarily content[0] — collect every
    // text block instead of only the first.
    text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    // Surface empty responses as errors instead of silently returning an empty
    // review that downstream code would PATCH to GitHub as a blank comment (422).
    if (!text) {
      throw Object.assign(new Error(
        `Anthropic returned no text (stop_reason: ${response.stop_reason}, blocks: ${response.content.map((b) => b.type).join(",") || "none"})`,
      ), response.stop_reason === "refusal" ? { code: "PROVIDER_REFUSAL" } : {});
    }
  }
  return {
    text,
    completion: completionEvidence(response.stop_reason, useTool ? ["tool_use"] : ["end_turn"]),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
