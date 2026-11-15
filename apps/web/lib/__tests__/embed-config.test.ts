import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { fileURLToPath } from "node:url";
import { getEmbedConfig } from "@/lib/embed-config";
import { openAIEmbeddingClientOptions } from "@/lib/embed-openai-client";

const KEYS = [
  "OCTOPUS_EMBED_PROVIDER",
  "OCTOPUS_EMBED_MODEL",
  "OCTOPUS_EMBED_DIM",
  "OCTOPUS_EMBED_BASE_URL",
  "OCTOPUS_EMBED_API_KEY",
  "OPENAI_API_KEY",
  "OCTOPUS_OLLAMA_BASE_URL",
] as const;

describe("getEmbedConfig", () => {
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("defaults to OpenAI text-embedding-3-large @ 3072", () => {
    const c = getEmbedConfig();
    expect(c.provider).toBe("openai");
    expect(c.model).toBe("text-embedding-3-large");
    expect(c.dim).toBe(3072);
    expect(c.ollamaBaseUrl).toBeUndefined();
  });

  it("switches to Ollama defaults", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "ollama";
    const c = getEmbedConfig();
    expect(c.provider).toBe("ollama");
    expect(c.model).toBe("nomic-embed-text");
    expect(c.dim).toBe(768);
    expect(c.ollamaBaseUrl).toBe("http://localhost:11434");
  });

  it("respects per-model OpenAI dim defaults", () => {
    process.env.OCTOPUS_EMBED_MODEL = "text-embedding-3-small";
    expect(getEmbedConfig().dim).toBe(1536);
  });

  it("respects per-model Ollama dim defaults", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "ollama";
    process.env.OCTOPUS_EMBED_MODEL = "mxbai-embed-large";
    expect(getEmbedConfig().dim).toBe(1024);
  });

  it("explicit OCTOPUS_EMBED_DIM overrides per-model default", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "ollama";
    process.env.OCTOPUS_EMBED_MODEL = "nomic-embed-text";
    process.env.OCTOPUS_EMBED_DIM = "1024";
    expect(getEmbedConfig().dim).toBe(1024);
  });

  it("treats unknown provider as openai", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "huggingface";
    expect(getEmbedConfig().provider).toBe("openai");
  });

  it("strips trailing slashes from OCTOPUS_OLLAMA_BASE_URL", () => {
    process.env.OCTOPUS_EMBED_PROVIDER = "ollama";
    process.env.OCTOPUS_OLLAMA_BASE_URL = "http://my-box:11434///";
    expect(getEmbedConfig().ollamaBaseUrl).toBe("http://my-box:11434");
  });

  it("reads an OpenAI-compatible embeddings endpoint for the openai provider only", () => {
    process.env.OCTOPUS_EMBED_BASE_URL = "https://llm.internal.example/litellm/v1//";
    expect(getEmbedConfig().openaiBaseUrl).toBe("https://llm.internal.example/litellm/v1");
    process.env.OCTOPUS_EMBED_PROVIDER = "ollama";
    expect(getEmbedConfig().openaiBaseUrl).toBeUndefined();
  });

  it("builds client options for the custom endpoint with its own key", () => {
    process.env.OPENAI_API_KEY = "synthetic-openai-key";
    expect(openAIEmbeddingClientOptions({})).toEqual({ apiKey: "synthetic-openai-key" });
    const custom = { openaiBaseUrl: "http://litellm:4000/v1" };
    expect(openAIEmbeddingClientOptions(custom)).toEqual({ apiKey: "synthetic-openai-key", baseURL: "http://litellm:4000/v1" });
    process.env.OCTOPUS_EMBED_API_KEY = "synthetic-gateway-key";
    expect(openAIEmbeddingClientOptions(custom)).toEqual({ apiKey: "synthetic-gateway-key", baseURL: "http://litellm:4000/v1" });
    // The gateway key never goes to api.openai.com.
    expect(openAIEmbeddingClientOptions({})).toEqual({ apiKey: "synthetic-openai-key" });
  });

  it("rejects a missing key and a non-http endpoint", () => {
    expect(() => openAIEmbeddingClientOptions({})).toThrow(/OPENAI_API_KEY/);
    process.env.OCTOPUS_EMBED_API_KEY = "synthetic-gateway-key";
    expect(() => openAIEmbeddingClientOptions({ openaiBaseUrl: "file:///etc/passwd" })).toThrow(/http\(s\) URL/);
    expect(() => openAIEmbeddingClientOptions({ openaiBaseUrl: "litellm:4000/v1" })).toThrow(/http\(s\) URL/);
  });

  it("ignores non-numeric OCTOPUS_EMBED_DIM", () => {
    process.env.OCTOPUS_EMBED_DIM = "garbage";
    expect(getEmbedConfig().dim).toBe(3072);
  });
});

it("sends embeddings to the configured OpenAI-compatible endpoint", async () => {
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/embeddings-base-url-harness.ts", import.meta.url))], {
    stdout: "pipe", stderr: "pipe",
  });
  const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code, error).toBe(0);
  expect(output.trim()).toBe("embeddings base URL checks passed");
});
