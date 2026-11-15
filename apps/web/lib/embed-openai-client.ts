import type { EmbedConfig } from "./embed-config";
import { MissingEmbeddingKeyError } from "./embedding-error";

/**
 * Client options for OpenAI-format embeddings. With OCTOPUS_EMBED_BASE_URL the
 * requests go to that operator-configured OpenAI-compatible endpoint (eg. a
 * LiteLLM proxy) instead of api.openai.com.
 */
export function openAIEmbeddingClientOptions(config: Pick<EmbedConfig, "openaiBaseUrl">): { apiKey: string; baseURL?: string } {
  const baseURL = config.openaiBaseUrl;
  const apiKey = (baseURL && process.env.OCTOPUS_EMBED_API_KEY) || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new MissingEmbeddingKeyError();
  if (!baseURL) return { apiKey };
  if (!/^https?:\/\//i.test(baseURL) || !URL.canParse(baseURL)) {
    throw new Error("OCTOPUS_EMBED_BASE_URL must be an http(s) URL");
  }
  return { apiKey, baseURL };
}
