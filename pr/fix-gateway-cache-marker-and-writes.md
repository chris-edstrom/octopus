Title: fix(gateway): drop the cache marker and record cache writes

## Summary

Refs #933 (related bugs 2 and 3).

- OpenAI-compatible gateways (`acp:`, `opencode:`) received the literal `<!--CACHE_BREAKPOINT-->` marker inside the system prompt, because only the Anthropic adapter splits on it. The marker is now stripped before sending.
- Gateway usage hardcoded `cacheWriteTokens` to 0. It now reuses the OpenAI adapter's helper, so `prompt_tokens_details.cache_write_tokens` is recorded when a gateway returns it.

## Testing

- `openai-sdk-real-harness`: the request body sent through the real OpenAI SDK has no marker, and a response carrying `cache_write_tokens` is recorded.
- Full app against a LiteLLM proxy in front of Bedrock Claude Sonnet 4.5: a pull request review through `acp:claude-sonnet` completed and was posted. LiteLLM returned no cache write count for that call, so the live run does not show the usage change. The harness covers it.
