Title: feat(settings): configure an OpenAI-compatible gateway from Settings

## Summary

Refs #933 (proposed solution, items 1 to 3).

- Provider Keys gains an "OpenAI-compatible gateway" form for the per-org base URL and API key. The fields already existed in the schema and had no UI.
- Models gains a gateway model field. It lists the ids the gateway serves at `/v1/models` and saves the choice as `acp:<model id>`.
- `GET /api/acp/models` backs that list. It is limited to organization admins and returns ids only.
- The self-hosting docs gain a recipe for LiteLLM and similar gateways.

## Testing

- `acp-gateway-models.test.ts`: unconfigured gateway, env gateway, per-org gateway with decrypted key, SSRF validation of the per-org URL before any request, unusable responses, and the 500 model cap.
- `acp-models-route` fixture: unauthenticated callers, no selected organization, non-members and non-admins are refused before the gateway is called.
- Full app against a LiteLLM proxy (podman) in front of Bedrock: saved the gateway in Provider Keys, the model field listed the proxy's 2 models, saved `acp:claude-sonnet` as the org default, and a pull request review ran through it and was posted.

![Gateway form in Provider Keys](https://raw.githubusercontent.com/chris-edstrom/octopus/handoff/notes/pr/img/gateway-form.png)

![Gateway model field in Models](https://raw.githubusercontent.com/chris-edstrom/octopus/handoff/notes/pr/img/gateway-model-field.png)

- The non-admin refusal was checked by the fixture only. The live run had one admin account.
