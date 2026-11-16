Title: fix(cli): gate local reviews on the model the request will use

## Summary

Refs #933 (related bug 4).

The CLI review routes called `isOrgOverSpendLimit(orgId)` before reading the request, so the credit gate always judged the org default model. With zero credits, an explicit `acp:`, `ollama:` or BYOK override was refused with HTTP 402 although that provider is never platform-billed. The reverse also held.

`isOrgOverSpendLimit` now accepts the per-request override and resolves its provider. The repo-aware route also passes the repository id, so a repo-level model pin is respected. An override that cannot be resolved falls back to the default-model gate.

## Testing

- `spend-limit.test.ts`: unbilled override with zero credits passes, billed override with an unbilled default is refused, unresolvable override falls back.
- `cli-review-safe-errors` fixture: both CLI review routes pass the override, and the repo route passes the repository id.
- Not exercised against a live deployment. The change is a pure function of the org, repository and model rows.
