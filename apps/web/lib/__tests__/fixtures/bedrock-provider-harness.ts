import { mock } from "bun:test";
import assert from "node:assert/strict";
mock.module("server-only", () => ({}));
globalThis.fetch = (() => { throw new Error("Unexpected network access"); }) as typeof fetch;
process.env.PROMPT_CACHE_TTL = "5m";
delete process.env.AWS_REGION;
type Body = { model: string; max_tokens: number; thinking?: unknown; output_config?: unknown; tools?: { name: string }[]; tool_choice?: unknown;
  system: { text: string; cache_control?: { type: string; ttl?: string } }[]; messages: { role: string; content: string }[] };
const calls: { region?: string; body: Body }[] = [];
const debits: number[] = [];
const stored: { provider: string; model: string; inputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; usedOwnKey: boolean }[] = [];
let content: unknown[] = [{ type: "text", text: "ok" }];
let stopReason = "end_turn";
class FakeBedrock {
  awsRegion?: string;
  constructor(options: { awsRegion?: string }) { this.awsRegion = options.awsRegion; }
  messages = { stream: (body: unknown) => { calls.push({ region: this.awsRegion, body: body as Body }); return {
    finalMessage: async () => ({ content, stop_reason: stopReason,
      usage: { input_tokens: 1000, output_tokens: 20, cache_read_input_tokens: 10000, cache_creation_input_tokens: 2000 } }),
  }; } };
}
mock.module("@anthropic-ai/bedrock-sdk", () => ({ AnthropicBedrock: FakeBedrock }));
mock.module("@octopus/db", () => ({ prisma: {
  availableModel: { findMany: async () => [] },
  organization: { findUnique: async () => ({ id: "org-a" }) },
  systemConfig: { findUnique: async () => null },
  aiUsage: { create: async ({ data }: { data: (typeof stored)[number] }) => { stored.push(data); return { id: "1" }; }, update: async () => ({}) },
} }));
mock.module("../../crypto", () => ({ decryptStringMaybeLegacy: (key: string) => key }));
mock.module("../../credits", () => ({ deductCredits: async (_org: string, amount: number) => { debits.push(amount); } }));
const { bedrockProvider } = await import("../../providers/bedrock");
const routed: string[] = [];
mock.module("../../providers", () => ({ getProvider: (name: string) => { routed.push(name); return bedrockProvider; } }));
const { createAiMessage } = await import("../../ai-router");
const { logAiUsage } = await import("../../ai-usage");
const { calcCost } = await import("../../cost");
const { CACHE_BREAKPOINT } = await import("../../providers/system-cache");

const modelId = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
const params = { model: `bedrock:${modelId}`, maxTokens: 128, cacheSystem: true,
  system: `stable instructions${CACHE_BREAKPOINT}volatile context`, messages: [{ role: "user" as const, content: "review this" }] };

// No region: a clear configuration error, before any SDK client exists.
await assert.rejects(bedrockProvider.create(params), /Bedrock is not configured — set AWS_REGION/);
// The router keeps provider messages private and reports the route.
const consoleError = console.error;
console.error = () => {};
await assert.rejects(createAiMessage(params, "org-a"), { name: "AiProviderFailure", provider: "bedrock", model: params.model });
console.error = consoleError;
assert.equal(calls.length, 0);

process.env.AWS_REGION = "us-west-2";
const response = await createAiMessage(params, "org-a");
assert.deepEqual(routed, ["bedrock", "bedrock"]);
const { region, body } = calls.at(-1)!;
assert.equal(region, "us-west-2");
// The namespace is stripped for the wire; the response keeps the routed id.
assert.equal(body.model, modelId);
assert.equal(response.model, `bedrock:${modelId}`);
assert.equal(response.provider, "bedrock");
assert.equal(response.text, "ok");
// Only the stable prefix is cached, with the deployment TTL.
assert.deepEqual(body.system, [
  { type: "text", text: "stable instructions", cache_control: { type: "ephemeral", ttl: "5m" } },
  { type: "text", text: "volatile context" },
]);
assert.deepEqual(body.messages, params.messages);
assert.equal(body.max_tokens, 128);
assert.equal("thinking" in body, false);
assert.equal("output_config" in body, false);
assert.deepEqual(response.usage, { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 10000, cacheWriteTokens: 2000 });

// An inference-profile ARN keeps its own colons and slashes.
const arn = "arn:aws:bedrock:us-west-2:123456789012:application-inference-profile/abc123";
await createAiMessage({ ...params, model: `bedrock:${arn}` }, "org-a");
assert.equal(calls.at(-1)!.body.model, arn);

// Structured output uses forced tool_choice; native output_config.format is never sent.
content = [{ type: "tool_use", id: "t", name: "Verdict", input: { ok: true } }];
stopReason = "tool_use";
const structured = await createAiMessage({ ...params, responseSchema: { name: "Verdict", schema: { type: "object" } } }, "org-a");
assert.equal(structured.text, '{"ok":true}');
assert.equal(calls.at(-1)!.body.tools![0].name, "Verdict");
assert.deepEqual(calls.at(-1)!.body.tool_choice, { type: "tool", name: "Verdict" });
assert.equal("output_config" in calls.at(-1)!.body, false);

// Operator-paid AWS usage: recorded as own-key with native counters, never debited.
await logAiUsage({ provider: "bedrock", model: response.model, operation: "review", organizationId: "org-a", ...response.usage });
assert.deepEqual(debits, []);
assert.equal(stored.length, 1);
assert.equal(stored[0].usedOwnKey, true);
assert.deepEqual([stored[0].inputTokens, stored[0].cacheReadTokens, stored[0].cacheWriteTokens], [1000, 10000, 2000]);
// Estimates read Bedrock input as exclusive of cache tokens, like Anthropic.
const pricing = new Map([[response.model, { input: 3, output: 15 }]]);
assert.equal(
  calcCost(pricing, response.model, 1000, 20, 10000, 2000, "bedrock"),
  calcCost(pricing, response.model, 1000, 20, 10000, 2000, "anthropic"),
);
console.log("PASS bedrock provider");
