Title: feat(gateway): accept gateway base URLs with a path prefix

## Summary

Refs #933 (proposed solution, item 4). Stacked on the gateway settings PR: review that one first, this diff shrinks once it merges.

`validateProviderUrl` reduced every provider URL to its origin, so a gateway served under a sub-path (for example a LiteLLM proxy at `https://tools.example.com/litellm`) could not be configured.

A `keepPath` option, used only for the `acp` and `opencode` gateways, keeps the normalized path as a prefix. Query, fragment and credentials are still dropped and the same host checks apply. A base URL pasted with the conventional trailing `/v1` is used as-is. Ollama and every other caller stay origin-only.

## Testing

- `url-validation` tests: prefix kept, trailing slash and `/v1` handling, query and credentials dropped, host checks unchanged, other callers still origin-only.
- `acp-gateway-models.test.ts`: the model list is fetched from `/v1/models` under the prefix.
- Full app against a LiteLLM proxy with no prefix: model listing and a review both work, so the origin-only case did not regress.
- A base URL with a real path prefix was not exercised against a live gateway.
