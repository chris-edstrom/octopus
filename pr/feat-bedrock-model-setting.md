Title: feat(settings): add an AWS Bedrock model field

Stacked on the Bedrock provider PR (`feat/bedrock-provider`). Open it after that one merges, or as a stacked draft.

## Summary

A `bedrock:` model id has no `AvailableModel` row, so the Models page could not select one. The organization default had to be written to the database.

The Models page now shows an "AWS Bedrock model" field when `AWS_REGION` is set. It takes a model id, an inference-profile id or an ARN and saves it as `bedrock:<id>`. The id in use gets its own option in the model select, and it is shown as the organization default name.

There is no model list. Model access differs per AWS account and region, and listing would need the Bedrock control-plane SDK.

## Testing

- `bedrock-model-id.test.ts` (4 tests): prefixing of model ids, inference-profile ids and ARNs, a pasted `bedrock:` id, blank input.
- `tsc --noEmit` and `eslint` on the changed files: 0 errors.
- Browser, self-hosted dev server with `AWS_REGION=us-east-1`: typed `us.anthropic.claude-sonnet-4-5-20250929-v1:0`, saved, reloaded. The select and the field both showed the saved id.

![Bedrock model field](https://raw.githubusercontent.com/chris-edstrom/octopus/handoff/notes/pr/img/bedrock-model-field.png)

The screenshot is from a build that also has the gateway settings PR, which adds the field above it.

## Notes

- Conflicts with the gateway settings PR in `models-settings.tsx` (4 hunks, both sides are kept). Whichever merges second needs a rebase.
- Per-repository model overrides still list catalog models only.
