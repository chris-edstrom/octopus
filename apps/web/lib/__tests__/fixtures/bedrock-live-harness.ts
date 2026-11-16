import { mock } from "bun:test";
import assert from "node:assert/strict";

// The Bedrock adapter against real AWS: two billed requests, a few cents. Run by
// bedrock-live.test.ts when BEDROCK_LIVE_MODEL is set. Credentials come from the
// AWS chain (AWS_PROFILE, SSO, instance role) and the region from AWS_REGION.
mock.module("server-only", () => ({}));
process.env.PROMPT_CACHE_TTL = "5m";

const { bedrockProvider } = await import("../../providers/bedrock");
const { CACHE_BREAKPOINT } = await import("../../providers/system-cache");
const modelId = process.env.BEDROCK_LIVE_MODEL!;
// Bedrock caches a prefix only above a per-model minimum (1024 to 4096 tokens),
// so the stable part is padded. The timestamp keeps each run's prefix new.
const stable = `You review code. Reply in one short sentence. ${Date.now()}\n` + "Rule: name the file and the line.\n".repeat(800);

const usage = [];
for (const run of [1, 2]) {
  const result = await bedrockProvider.create({
    model: `bedrock:${modelId}`, maxTokens: 64, cacheSystem: true, maxRetries: 0,
    system: `${stable}${CACHE_BREAKPOINT}Run ${run}.`,
    messages: [{ role: "user", content: "Say hello." }],
  });
  assert.equal(result.provider, "bedrock");
  assert.equal(result.completion?.state, "completed");
  assert.ok(result.text.length > 0, "the model answered");
  usage.push(result.usage);
}
assert.ok(usage[0].cacheWriteTokens > 0, `the first request writes the stable prefix to the cache: ${JSON.stringify(usage[0])}`);
assert.equal(usage[1].cacheReadTokens, usage[0].cacheWriteTokens, `the second request reads it back: ${JSON.stringify(usage[1])}`);
console.log(`Bedrock ${modelId} live checks passed (${usage[1].cacheReadTokens} cached tokens read)`);
