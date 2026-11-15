import { mock } from "bun:test";
import assert from "node:assert/strict";

// The real embeddings module and the real openai SDK against a loopback
// OpenAI-compatible endpoint. Own process: the embeddings client is cached.
mock.module("server-only", () => ({}));
// An org default that only api.openai.com would know; it must not be sent to the custom endpoint.
mock.module("@/lib/ai-client", () => ({ getEmbedModel: async () => "text-embedding-3-large" }));
const usage: { provider: string; model: string }[] = [];
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async (entry: { provider: string; model: string }) => { usage.push(entry); } }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));

type Hit = { path: string; authorization: string | null; body: { model: string; input: string[]; dimensions?: number } };
const hits: Hit[] = [];
const vector = [0.25, -0.5, 1];
const base64 = Buffer.from(new Float32Array(vector).buffer).toString("base64");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const hit: Hit = { path: new URL(request.url).pathname, authorization: request.headers.get("authorization"), body: await request.json() as Hit["body"] };
  hits.push(hit);
  return Response.json({ data: hit.body.input.map((_, index) => ({ index, embedding: base64 })), usage: { prompt_tokens: 2, total_tokens: 2 } });
} });

process.env.OPENAI_API_KEY = "synthetic-openai-key";
process.env.OCTOPUS_EMBED_PROVIDER = "openai";
process.env.OCTOPUS_EMBED_BASE_URL = `http://127.0.0.1:${server.port}/litellm/v1/`;
process.env.OCTOPUS_EMBED_API_KEY = "synthetic-gateway-key";
process.env.OCTOPUS_EMBED_MODEL = "bedrock-titan-embed";
process.env.OCTOPUS_EMBED_DIM = "3";
delete process.env.OPENAI_BASE_URL;

try {
  const { createEmbeddings } = await import("@/lib/embeddings");
  assert.deepEqual(await createEmbeddings(["a", "", "b"], { organizationId: "org", operation: "index" }), [vector, [], vector]);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].path, "/litellm/v1/embeddings", "the request goes to the configured endpoint, path prefix included");
  assert.equal(hits[0].authorization, "Bearer synthetic-gateway-key", "the gateway key is used, not the OpenAI key");
  assert.equal(hits[0].body.model, "bedrock-titan-embed", "the operator's model wins over the org default");
  assert.deepEqual(hits[0].body.input, ["a", "b"]);
  assert.equal("dimensions" in hits[0].body, false, "the dimensions argument is only sent to text-embedding-3 models");
  assert.deepEqual(usage.map(entry => entry.model), ["bedrock-titan-embed"]);
  console.log("embeddings base URL checks passed");
} finally {
  server.stop(true);
}
