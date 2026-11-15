import { afterEach, describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { MissingEmbeddingKeyError, OllamaEmbeddingUrlError, operatorEmbeddingAdvice } from "@/lib/embedding-error";

const env = process.env as Record<string, string | undefined>;
const original = env.NODE_ENV;
afterEach(() => { env.NODE_ENV = original; });

describe("operatorEmbeddingAdvice", () => {
  it("is withheld on hosted production deployments", () => {
    env.NODE_ENV = "production";
    expect(operatorEmbeddingAdvice(new MissingEmbeddingKeyError(), false)).toBeUndefined();
  });

  it("is shown to self-hosted operators in production", () => {
    env.NODE_ENV = "production";
    expect(operatorEmbeddingAdvice(new MissingEmbeddingKeyError(), true)).toBe("Set OPENAI_API_KEY to configure OpenAI embeddings.");
    expect(operatorEmbeddingAdvice(new OllamaEmbeddingUrlError(), true)).toMatch(/Ollama embedding URL was rejected/);
  });

  it("is shown in development", () => {
    env.NODE_ENV = "development";
    expect(operatorEmbeddingAdvice(new MissingEmbeddingKeyError(), false)).toBe("Set OPENAI_API_KEY to configure OpenAI embeddings.");
  });

  it("finds a wrapped embedding failure and never echoes other errors", () => {
    env.NODE_ENV = "production";
    const wrapped = new Error("index batch failed", { cause: new Error("embed", { cause: new MissingEmbeddingKeyError() }) });
    expect(operatorEmbeddingAdvice(wrapped, true)).toBe("Set OPENAI_API_KEY to configure OpenAI embeddings.");
    expect(operatorEmbeddingAdvice(new Error("synthetic-provider-secret"), true)).toBeUndefined();
    expect(operatorEmbeddingAdvice("synthetic-provider-secret", true)).toBeUndefined();
  });
});

it("returns the advice from the index-local route only to self-hosted operators", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/local-index-embedding-advice.ts", import.meta.url))], {
    stdout: "pipe", stderr: "pipe",
  });
  const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, error).toBe(0);
  expect(output.trim()).toBe("index-local embedding advice checks passed");
});
