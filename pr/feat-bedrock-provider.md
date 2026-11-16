Title: feat(providers): add native AWS Bedrock provider with prompt caching

## Summary

Claude on Bedrock was only reachable through an OpenAI-compatible gateway. That path sends Chat Completions bodies, so Anthropic prompt caching is lost.

This adds a `bedrock:` provider built on `@anthropic-ai/bedrock-sdk` (pinned 0.29.2). It sends the same Messages body as the Anthropic adapter, including the cached system prefix. The region comes from `AWS_REGION` and credentials from the standard AWS chain (environment keys, profile, SSO, instance role). Model ids are `bedrock:<model or inference profile id>`.

## Testing

- `bedrock-provider.test.ts`: routing, request preparation, usage mapping, error mapping.
- `bedrock-sdk-real-harness`: the real SDK with only `fetch` replaced. Asserts the `/model/<id>/invoke-with-response-stream` route, SigV4 signing, the Bedrock body shape and the cached system prefix.
- `bedrock-live.test.ts` (opt-in, set `BEDROCK_LIVE_MODEL`): two requests against real AWS in `us-east-1` with `us.anthropic.claude-sonnet-4-5-20250929-v1:0` and SSO profile credentials. The first wrote 4,018 tokens to the prompt cache and the second read 4,018 back.
- Full app: a pull request review with the org default set to the same `bedrock:` model completed, posted one inline comment and set a failed commit status for a critical finding. Usage row: 3,566 input, 1,610 output, 10,887 cache write tokens.

![Review produced through Bedrock](https://raw.githubusercontent.com/chris-edstrom/octopus/handoff/notes/pr/img/gitea-review-score.png)

## Notes

- No settings field accepts a `bedrock:` id in this PR. The org default was set in the database for the live run. A follow-up PR (`feat/bedrock-model-setting`) adds the field.
- The validation pass still calls `claude-sonnet-5` on the Anthropic API whatever the org model is. Without `ANTHROPIC_API_KEY` it logs an error and keeps all findings. A separate PR (`fix/validation-model-without-anthropic-key`) fixes that for every provider.
- `bun.lock` grows by about 1,400 lines for the AWS credential packages.
- Conflicts with the path-prefix PR on one line of the self-hosting docs page. Whichever merges second needs a rebase.
