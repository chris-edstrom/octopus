Title: fix(review): validate on the review model when no Anthropic key exists

## Summary

The validation pass (`validateFindings`) always calls `claude-sonnet-5` on the Anthropic API. An install that reviews through a gateway, Ollama or another provider has no Anthropic key. Every validation call then fails, the review logs `Two-pass validation failed, keeping all findings`, and no finding is filtered.

`resolveValidationModel` now picks the model:

- `ANTHROPIC_API_KEY` is set, or the organization has its own Anthropic key: `claude-sonnet-5`, as before.
- Neither exists: the model that wrote the findings.

`reviewer.ts` and `review-core.ts` pass their resolved review model. The usage row records the model that ran.

## Testing

- `review-validation-model.test.ts` (6 tests): platform key, organization key, no key, no review model given, and that `validateFindings` sends the request and records usage on the chosen model.
- `review-follow-up`, `review-fallback-safe-errors`, `review-verification` and `cli-review-safe-errors` pass (11 tests).
- `tsc --noEmit` in `apps/web`: 0 errors.
- Not run against a live provider. The failure was seen on a self-hosted install with no Anthropic key, reviewing through an OpenAI-compatible gateway.

## Notes

- Hosted behaviour is unchanged: the platform key is always set there.
- An organization with only an OpenAI or Google key on a self-hosted install now validates on its review model. Before, validation failed for it too.
