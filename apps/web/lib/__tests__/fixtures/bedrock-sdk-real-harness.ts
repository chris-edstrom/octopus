import { mock } from "bun:test";
import assert from "node:assert/strict";

// The Bedrock adapter through the REAL @anthropic-ai/bedrock-sdk, with only the
// network replaced. Guards the wire contract a fake SDK cannot: the InvokeModel
// route, SigV4 signing and the Bedrock body shape. A Bedrock SDK release that
// does not match the installed @anthropic-ai/sdk sends unsigned requests to
// /v1/messages instead, which this catches. Own process so mock.module in other
// tests cannot replace the SDK.
mock.module("server-only", () => ({}));
process.env.AWS_REGION = "us-west-2";
process.env.AWS_ACCESS_KEY_ID = "AKIASYNTHETICKEY0000";
process.env.AWS_SECRET_ACCESS_KEY = "synthetic-secret-access-key";
process.env.PROMPT_CACHE_TTL = "5m";
for (const key of ["AWS_SESSION_TOKEN", "AWS_PROFILE", "AWS_BEARER_TOKEN_BEDROCK", "ANTHROPIC_BASE_URL", "ANTHROPIC_BEDROCK_BASE_URL"]) delete process.env[key];

type Sent = { url: string; method: string; headers: Headers; body: Record<string, unknown> };
const sent: Sent[] = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input instanceof Request ? input : String(input), init);
  sent.push({ url: request.url, method: request.method, headers: request.headers, body: JSON.parse(await request.text()) });
  // A request-level refusal: the adapter must surface it without a retry storm.
  return Response.json({ message: "synthetic validation failure" }, { status: 400, headers: { "x-amzn-errortype": "ValidationException" } });
}) as typeof fetch;

try {
  const { bedrockProvider } = await import("../../providers/bedrock");
  const { CACHE_BREAKPOINT } = await import("../../providers/system-cache");
  const modelId = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
  await assert.rejects(bedrockProvider.create({
    model: `bedrock:${modelId}`, maxTokens: 64, cacheSystem: true, maxRetries: 0,
    system: `stable instructions${CACHE_BREAKPOINT}volatile context`,
    messages: [{ role: "user", content: "review this" }],
  }), { status: 400 });

  assert.equal(sent.length, 1, "a 400 is not retried");
  const { url, method, headers, body } = sent[0];
  assert.equal(method, "POST");
  assert.equal(url, `https://bedrock-runtime.us-west-2.amazonaws.com/model/${modelId}/invoke-with-response-stream`);
  assert.match(headers.get("authorization") ?? "",
    /^AWS4-HMAC-SHA256 Credential=AKIASYNTHETICKEY0000\/\d{8}\/us-west-2\/bedrock\/aws4_request, SignedHeaders=[^,]+, Signature=[0-9a-f]{64}$/);
  assert.ok(headers.get("x-amz-date"));
  assert.equal(headers.get("x-api-key"), null, "no Anthropic API key header goes to AWS");
  // Bedrock takes the model in the path and the API version in the body.
  assert.equal(body.anthropic_version, "bedrock-2023-05-31");
  assert.equal("model" in body, false);
  assert.equal("stream" in body, false);
  assert.equal(body.max_tokens, 64);
  assert.deepEqual(body.system, [
    { type: "text", text: "stable instructions", cache_control: { type: "ephemeral", ttl: "5m" } },
    { type: "text", text: "volatile context" },
  ]);
  assert.deepEqual(body.messages, [{ role: "user", content: "review this" }]);
  assert.ok(!JSON.stringify(sent).includes("synthetic-secret-access-key"), "the secret key never leaves the process");
  console.log("PASS real Bedrock SDK request");
} finally {
  globalThis.fetch = nativeFetch;
}
