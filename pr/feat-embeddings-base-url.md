Title: feat(embeddings): support an OpenAI-compatible embeddings endpoint

## Summary

Refs #933 (proposed solution, item 4).

Self-hosters who route models through an OpenAI-compatible gateway had to keep a separate OpenAI key or an Ollama server just for embeddings. The SDK's `OPENAI_BASE_URL` would redirect chat models too.

`OCTOPUS_EMBED_BASE_URL` points the `openai` embedding provider at such an endpoint, authenticated with `OCTOPUS_EMBED_API_KEY` (falling back to `OPENAI_API_KEY`). The model and dimension come from `OCTOPUS_EMBED_MODEL` and `OCTOPUS_EMBED_DIM`. Org and platform default embedding models are not applied, because a custom endpoint serves only what the operator configured.

## Testing

- `embeddings-base-url-harness`: requests go to the configured endpoint with the configured key, model and dimension, and the org model is skipped.
- `embed-config` tests: parsing, trailing slash handling and the key fallback.
- Full app with `OCTOPUS_EMBED_BASE_URL` pointing at a LiteLLM proxy (podman) that serves Bedrock Titan Text Embeddings v2 as `titan-embed`, `OCTOPUS_EMBED_DIM=1024`, no `OPENAI_API_KEY`: 6 repositories indexed into Qdrant, and review-time retrieval and finding verification used the same endpoint. Usage rows were written with provider `openai` and model `titan-embed`.

## Notes

- Cost is recorded as $0 for a model id the price table does not know.
