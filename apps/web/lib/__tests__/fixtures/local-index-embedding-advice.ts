import { mock } from "bun:test";
import assert from "node:assert/strict";

// The real index-local route with a failing embedding step. Only the embedding
// advice may reach the CLI, and only where the caller is the operator.
let failure: unknown;
const marked: string[] = [];
mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ NextResponse: { json: Response.json } }));
mock.module("@octopus/db", () => ({ prisma: {} }));
mock.module("@/lib/api-auth", () => ({ authenticateApiToken: async () => ({ org: { id: "synthetic-org" } }) }));
mock.module("@/lib/audit", () => ({ writeAuditLog: async () => {} }));
mock.module("@/lib/cost", () => ({ isOrgOverSpendLimit: async () => false }));
mock.module("@/app/api/cli/repos/by-remote/route", () => ({ normaliseRemoteUrl: () => ({ provider: "github", fullName: "synthetic/repo" }) }));
mock.module("@/lib/index-local", () => ({
  IN_FLIGHT_WINDOW_MS: 300_000,
  LocalIndexConflict: class extends Error {},
  prepareRepoForLocalIndex: async () => ({ ok: true, repoId: "synthetic-repo", uploadId: "upload", reIndex: false }),
  claimLocalIndexBatch: async () => ({ upload: { id: "upload" } }),
  indexLocalBatch: async () => { throw failure; },
  markLocalIndexFailed: async (repoId: string) => { marked.push(repoId); },
  recordLocalIndexProgress: async () => {},
}));
const { POST } = await import("@/app/api/cli/repos/index-local/route");
const { MissingEmbeddingKeyError, OllamaEmbeddingUrlError } = await import("@/lib/embedding-error");
const index = async () => {
  const response = await POST(new Request("https://example.invalid/api/cli/repos/index-local", { method: "POST", body: JSON.stringify({
    remoteUrl: "https://example.invalid/synthetic/repo", totalBatches: 1, totalFiles: 1, batchIndex: 0, files: [{ path: "file.ts", content: "synthetic" }],
  }) }));
  return [response.status, (await response.json()).error];
};
const env = process.env as Record<string, string | undefined>;
const secret = "synthetic-provider-secret";
const logs: unknown[][] = [];
console.error = (...args: unknown[]) => { logs.push(args); };

env.NODE_ENV = "production";
for (const flag of ["OCTOPUS_SELF_HOSTED", "NEXT_PUBLIC_OCTOPUS_SELF_HOSTED"]) delete env[flag];
failure = new MissingEmbeddingKeyError();
assert.deepEqual(await index(), [500, "Indexing batch failed"], "hosted production keeps the generic message");

env.OCTOPUS_SELF_HOSTED = "true";
assert.deepEqual(await index(), [500, "Indexing batch failed: Set OPENAI_API_KEY to configure OpenAI embeddings."]);
failure = new Error("embedding step failed", { cause: new OllamaEmbeddingUrlError() });
assert.match((await index())[1], /^Indexing batch failed: Configured Ollama embedding URL was rejected/, "a wrapped embedding failure is found");
failure = Object.assign(new Error(secret), { status: 503 });
assert.deepEqual(await index(), [500, "Indexing batch failed"], "other failures never reach a self-hosted client in production");
assert.equal(marked.length, 4, "every failed batch marks the repository failed");
console.log("index-local embedding advice checks passed");
