import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

let orgRow: { anthropicApiKey: string | null } | null = null;
mock.module("@octopus/db", () => ({
  prisma: { organization: { findUnique: () => Promise.resolve(orgRow) } },
}));
mock.module("@/lib/qdrant", () => ({ searchSimilarChunks: async () => [] }));
mock.module("@/lib/embeddings", () => ({ createEmbeddings: async () => [] }));

const usage: { model: string; provider: string }[] = [];
mock.module("@/lib/ai-usage", () => ({
  logAiUsage: async (row: { model: string; provider: string }) => { usage.push(row); },
}));

const requested: string[] = [];
mock.module("@/lib/ai-router", () => ({
  createAiMessage: async (params: { model: string }) => {
    requested.push(params.model);
    return {
      model: params.model,
      provider: "acp",
      text: '[{"index":0,"confidence":95,"citation":"+const a = 1"}]',
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
  },
}));

const { VALIDATION_MODEL, resolveValidationModel, validateFindings } = await import("@/lib/review-validation");

const platformKey = process.env.ANTHROPIC_API_KEY;
afterAll(() => {
  if (platformKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = platformKey;
});

beforeEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
  orgRow = { anthropicApiKey: null };
  usage.length = 0;
  requested.length = 0;
});

const finding = {
  severity: "high", title: "t", filePath: "a.ts", startLine: 1, endLine: 1,
  category: "bug", description: "d", suggestion: "s", confidence: 80,
};

describe("resolveValidationModel", () => {
  it("keeps the Anthropic validation model when the platform key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-platform";
    expect(await resolveValidationModel("org", "acp:claude-sonnet")).toBe(VALIDATION_MODEL);
  });

  it("keeps the Anthropic validation model when the organization has its own key", async () => {
    orgRow = { anthropicApiKey: "encrypted" };
    expect(await resolveValidationModel("org", "gpt-5")).toBe(VALIDATION_MODEL);
  });

  it("uses the review model when no Anthropic key exists", async () => {
    expect(await resolveValidationModel("org", "acp:claude-sonnet")).toBe("acp:claude-sonnet");
  });

  it("keeps the Anthropic validation model when the caller names no review model", async () => {
    expect(await resolveValidationModel("org")).toBe(VALIDATION_MODEL);
  });
});

describe("validateFindings", () => {
  it("validates and records usage on the review model when no Anthropic key exists", async () => {
    const kept = await validateFindings(
      [finding], "+const a = 1", "org", 70, undefined, "[test]", undefined, undefined, "ollama:qwen2.5-coder:32b",
    );
    expect(requested).toEqual(["ollama:qwen2.5-coder:32b"]);
    expect(usage.map((u) => u.model)).toEqual(["ollama:qwen2.5-coder:32b"]);
    expect(kept).toHaveLength(1);
  });

  it("validates on the Anthropic model when the platform key is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-platform";
    await validateFindings(
      [finding], "+const a = 1", "org", 70, undefined, "[test]", undefined, undefined, "ollama:qwen2.5-coder:32b",
    );
    expect(requested).toEqual([VALIDATION_MODEL]);
  });
});
