Title: fix(providers): honour OCTOPUS_SELF_HOSTED when validating provider URLs

## Summary

Refs #933 (related bug 1).

`validateProviderUrl` decided hosted versus self-hosted from `SELF_HOSTED`, a name that is undocumented and unset in the official self-host image. The image sets `OCTOPUS_SELF_HOSTED` and `NEXT_PUBLIC_OCTOPUS_SELF_HOSTED`, so per-org gateway and Ollama URLs on localhost or a LAN address were rejected, and so was `OCTOPUS_OLLAMA_BASE_URL` for embeddings.

The default now comes from `isSelfHosted()`. `SELF_HOSTED=true` keeps working for deployments that already set it. The error text names the documented flag.

## Testing

- `url-validation.test.ts`: loopback and LAN hosts are accepted with `OCTOPUS_SELF_HOSTED=true` or `NEXT_PUBLIC_OCTOPUS_SELF_HOSTED=true`, rejected with no flag, and the rejection names `OCTOPUS_SELF_HOSTED`. The existing `SELF_HOSTED` cases still pass.
- Two fixtures updated for the new error text.
- Full app with `OCTOPUS_SELF_HOSTED=true` and no `SELF_HOSTED`: a per-org gateway at a private `http://172.x` address (a LiteLLM container) was accepted, its model list loaded in Settings, and a review ran through it.
