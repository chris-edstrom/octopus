Title: fix(review): flag local reviews whose model output was cut off

## Summary

Refs #933 (related bug 5).

`generateBareLocalReview` and `generateLocalReview` never read `response.completion`, so a response that stopped at `finish_reason: "length"` was parsed and returned like a complete review. Only the pull request pipeline checked it.

Both functions now return `outputIncomplete` when the provider reports an incomplete completion. The CLI review routes pass it through, and `octp review` prints a warning in its human and markdown output. Providers that give no completion evidence are unaffected.

## Testing

- `local-review-truncation.test.ts`: incomplete, complete and unknown completion states for both functions, and the route pass-through.
- `apps/cli` typecheck is clean.
- Not exercised against a live model. Forcing a truncated response needs a provider stub, which the test supplies.
