import "server-only";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { prepareAnthropicRequest, readAnthropicMessage } from "./anthropic-request";
import { observeAiRequest, sdkRequestOptions } from "./request-evidence";

/**
 * Claude on AWS Bedrock through the native InvokeModel API. Bedrock takes the
 * Anthropic Messages body, so `cache_control` on the stable system prefix is
 * kept; the OpenAI-compatible gateways (acp, opencode) drop it.
 *
 * Operator-level only: AWS_REGION selects the endpoint and credentials come
 * from the standard AWS chain (env keys, shared profile, IAM role). There is
 * no per-organization key.
 *
 * Model ids are namespaced "bedrock:<model id | inference-profile id | ARN>".
 * The Claude-5 thinking tuning and native JSON output in the request builder
 * match bare Anthropic model names, so a Bedrock id gets neither: the request
 * carries no adaptive thinking, effort, output_config or max_tokens floor, and
 * structured output uses forced tool_choice. A caller's `thinking: "disabled"`
 * is still sent as `{ type: "disabled" }`.
 */
const MODEL_PREFIX = "bedrock:";

// Same whole-call deadline as the Anthropic adapter; the SDK timeout only covers response headers.
const BEDROCK_CALL_TIMEOUT_MS = 14 * 60 * 1000;

let client: AnthropicBedrock | null = null;

function getClient(): AnthropicBedrock {
  const awsRegion = process.env.AWS_REGION;
  if (!awsRegion) {
    throw new Error(
      "Bedrock is not configured — set AWS_REGION and provide AWS credentials " +
        "(AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, a shared profile, or an IAM role).",
    );
  }
  if (!client || client.awsRegion !== awsRegion) client = new AnthropicBedrock({ awsRegion });
  return client;
}

export const bedrockProvider: Provider = {
  name: "bedrock",
  supportsJsonSchema: true,
  async create(params: AiCreateParams): Promise<AiResponse> {
    const model = params.model.startsWith(MODEL_PREFIX) ? params.model.slice(MODEL_PREFIX.length) : params.model;
    const useTool = params.responseSchema !== undefined;
    const body = prepareAnthropicRequest({ ...params, model }, process.env.PROMPT_CACHE_TTL === "5m" ? "5m" : "1h");
    const timeout = AbortSignal.timeout(BEDROCK_CALL_TIMEOUT_MS);
    const stream = getClient().messages.stream(observeAiRequest(params, "bedrock", body) as Anthropic.MessageCreateParamsStreaming, {
      ...sdkRequestOptions(params),
      signal: params.signal ? AbortSignal.any([params.signal, timeout]) : timeout,
    });

    let response: Anthropic.Message;
    try {
      response = await stream.finalMessage();
    } catch (err) {
      if (
        err instanceof Anthropic.APIUserAbortError ||
        (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError"))
      ) {
        throw new Error(
          `Bedrock call interrupted or timed out within ${BEDROCK_CALL_TIMEOUT_MS / 1000}s (model: ${params.model})`,
        );
      }
      throw err;
    }

    return { ...readAnthropicMessage(response, useTool), provider: "bedrock", model: params.model };
  },
};
