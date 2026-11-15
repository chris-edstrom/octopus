import { mock } from "bun:test";
import assert from "node:assert/strict";

// Real generateLocalReview / generateBareLocalReview over a stubbed model call:
// only the provider's completion evidence varies between runs.
mock.module("server-only", () => ({}));
let completion: { state: "completed" | "incomplete" | "unknown"; reason: string | null } | undefined;
const finding = { severity: "🟠", title: "Missing check", filePath: "src/a.ts", startLine: 1, endLine: 1, category: "Bug", description: "Missing check", suggestion: "", confidence: 95 };
const org = { id: "org", type: 1, defaultReviewConfig: {}, reviewLanguage: "en" };
mock.module("@octopus/db", () => ({ prisma: {
  repository: { findUnique: async () => ({ id: "repo", fullName: "example/repo", organization: org, reviewConfig: {} }) },
  systemConfig: { findUnique: async () => null },
  reviewIssue: { findMany: async () => [] },
  organization: { findUnique: async () => org },
} }));
mock.module("@/lib/qdrant", () => ({ searchSimilarChunks: async () => [], searchKnowledgeChunks: async () => [], searchReviewChunks: async () => [] }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async () => [[1]] }));
mock.module("@/lib/reranker", () => ({ rerankDocuments: async () => [] }));
mock.module("@/lib/knowledge-context", () => ({ getAlwaysIncludeKnowledge: async () => [], mergeKnowledgeChunks: () => [] }));
mock.module("@/lib/feedback-suppression", () => ({ suppressFindingsFromFeedback: async (items: unknown[]) => items }));
mock.module("@/lib/review-routing", () => ({ resolveReviewModel: async () => "fixture-model" }));
mock.module("@/lib/ai-client", () => ({ getReviewModel: async () => "fixture-model" }));
mock.module("@/lib/ai-usage", () => ({ logAiUsage: async () => {} }));
mock.module("@/lib/ai-router", () => ({
  getProviderForModel: async () => "acp",
  createAiMessage: async () => ({
    provider: "acp", ...(completion ? { completion } : {}),
    text: `Summary\n| 🟠 High | 1 |\n<!-- OCTOPUS_FINDINGS_START -->\n${JSON.stringify([finding])}\n<!-- OCTOPUS_FINDINGS_END -->`,
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
}));
mock.module("@/lib/review-validation", () => ({
  gatherCrossFileContext: async () => "", gatherVerificationContext: async () => new Map(),
  validateFindings: async (items: unknown[]) => items,
}));

const { generateLocalReview, generateBareLocalReview } = await import("@/lib/review-core");
const diff = "diff --git a/src/a.ts b/src/a.ts\n+change";
const reviews = {
  bare: () => generateBareLocalReview({ diff, orgId: "org" }),
  contextual: () => generateLocalReview({ diff, repoId: "repo", orgId: "org" }),
};
for (const [name, review] of Object.entries(reviews)) {
  completion = { state: "incomplete", reason: "length" };
  const cut = await review();
  assert.equal(cut.outputIncomplete, true, `${name}: a response cut off at the token limit is flagged`);
  assert.equal(cut.findings.length, 1, `${name}: the findings parsed so far are still returned`);
  // Completed responses, and providers that report no completion evidence, are unchanged.
  for (completion of [{ state: "completed" as const, reason: "stop" }, { state: "unknown" as const, reason: null }, undefined]) {
    assert.ok(!("outputIncomplete" in await review()), `${name}: ${completion?.state ?? "no evidence"} is not flagged`);
  }
}
console.log("local review truncation checks passed");
