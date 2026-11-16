# Handoff: Gitea, OpenAI-compatible gateway and Bedrock work

Written 2026-11-15. This branch (`handoff/notes`) holds only this file. It is not meant
for an upstream PR. Delete it once the PRs below are open.

## Goal

Make octopus usable with a Gitea server and with Claude on AWS Bedrock, either through a
LiteLLM proxy or natively. Fix upstream issue
[#933](https://github.com/octopusreview/octopus/issues/933) on the way, one pull request
per logical change.

## State

- Ten branches are pushed to this fork. All were cut from upstream `master` at
  `f1086e37` (release 1.4.23).
- No pull request is open against `octopusreview/octopus`. The owner wants to review the
  branches first.
- Every commit is authored and committed as `Chris Edstrom <cedstrom@care-harmony.com>`.
- Upstream had no open PR or issue for Gitea or Bedrock when this was written.

## Branches

| Branch | Change | Base | Issue 933 |
|---|---|---|---|
| `fix/gitea-webhook-headers` | Webhook route falls back to `x-gitea-signature` / `x-gitea-event`. Adds a live Gitea test. | `master` | none |
| `fix/provider-url-self-hosted-flag` | `validateProviderUrl` honours `OCTOPUS_SELF_HOSTED`, keeps `SELF_HOSTED` working. | `master` | bug 1 |
| `fix/gateway-cache-marker-and-writes` | Gateway strips `<!--CACHE_BREAKPOINT-->` and records cache-write tokens. | `master` | bugs 2, 3 |
| `fix/cli-spend-gate-requested-model` | CLI review routes gate on the request's model override. | `master` | bug 4 |
| `fix/bare-review-truncation` | Local reviews return `outputIncomplete`; `octp review` prints a warning. | `master` | bug 5 |
| `fix/cli-index-embeddings-error` | index-local returns embedding advice on self-hosted installs. | `master` | bug 6 |
| `feat/gateway-settings-ui` | Provider Keys gateway card, gateway model picker, `/api/acp/models`, docs recipe. | `master` | items 1 to 3 |
| `feat/gateway-base-url-path-prefix` | `keepPath` for `acp` / `opencode` base URLs, trailing `/v1` accepted. | `feat/gateway-settings-ui` | item 4 |
| `feat/embeddings-base-url` | `OCTOPUS_EMBED_BASE_URL` / `OCTOPUS_EMBED_API_KEY` for an OpenAI-compatible embeddings endpoint. | `master` | item 4 |
| `feat/bedrock-provider` | Native `bedrock:` provider on `@anthropic-ai/bedrock-sdk` 0.29.2, keeps `cache_control`. | `master` | none |

## Dependencies between branches

- Nine branches are standalone.
- `feat/gateway-base-url-path-prefix` is stacked on `feat/gateway-settings-ui`. It makes
  the model listing use the same API root as reviews (`gatewayApiBase`) and rewrites the
  UI branch's "any path is dropped" text. Merge the UI PR first, then retarget this one.
- Nine branches (all except Bedrock) were merged into one temporary branch with zero
  conflicts. That merged tree passed typecheck, lint and the tests listed below.
- `feat/bedrock-provider` was not part of that merge test. It shares `cost.ts` with the
  spend-gate branch, and `.env.example` plus the self-hosting docs page with the
  embeddings and UI branches. Conflicts there are possible.

## What was verified

- `bun run typecheck` in `apps/web`: 0 errors on the nine-branch merge and on Bedrock.
- `eslint` on every changed file: clean.
- `apps/cli` typecheck: clean.
- Changed and neighbouring test files, run one file at a time on the merged tree: all pass.
- `scripts/gitea-live-test.sh` against Gitea 28.3.0 in podman: connection, repo listing,
  branch head, tree, file content, PR details, changed files, diff, comment create and
  edit, review with inline comments, stale-head refusal, four commit statuses, and seven
  webhook deliveries sent by Gitea itself. The same test returns 401 on `master`.
- Bedrock: the request was checked through the real SDK with `fetch` replaced. It hits
  `/model/<id>/invoke-with-response-stream`, is SigV4 signed, and carries
  `cache_control` on the system prefix.

## What was not verified

- Bedrock against real AWS. The machine had no AWS credentials. Unknown: real cache hits,
  whether a given model accepts `ttl: "1h"`, credential chain resolution.
- Bedrock sends `thinking: { type: "disabled" }` on short utility calls. Always-thinking
  Claude models probably reject that.
- The settings UI was never rendered in a browser. Save, remove and the model datalist
  are untested live.
- `scripts/gitea-live-test.sh` ran only on Windows with podman machine. Its docker and
  native Linux address detection is untested.
- The full upstream test suite was not run in one process. Several files use
  `mock.module`, which leaks between files in a single `bun test` run.
- `next build` was not run.

## Known gaps left on purpose

- `opencodeBaseUrl` / `opencodeApiKey` have the same missing settings UI as `acp` did.
- Per-repository model overrides still list catalogue models only.
- Chat routes (`app/api/chat`, `cli/chat`, `ask-octopus`, `slack-responder`) build
  `new Anthropic` directly and still need `ANTHROPIC_API_KEY`.
- Embeddings sent to a custom endpoint are logged with provider `openai`.
- Upstream CI runs a fixed list of test files. None of the new tests are in that list.
- No `CHANGELOG.md` edits. The upstream release script stamps the changelog.

## Running things locally

```bash
bun install                       # repo pins bun 1.3.4; bun 1.4.4 rewrites bun.lock, restore it
cd packages/db && DATABASE_URL=postgresql://octopus:octopus@localhost:43332/octopus bun run db:generate
cd apps/web && bun run typecheck  # about 3 minutes
cd apps/web && bun test lib/__tests__/<file>.test.ts
```

Live Gitea test (needs docker or podman, and `node` when the relay is used):

```bash
GITEA_LIVE_RELAY=1 CONTAINER_RUNTIME=podman bash scripts/gitea-live-test.sh
```

- `GITEA_LIVE_RELAY=1` is needed on Windows. The firewall blocks inbound connections to
  `bun.exe`, so deliveries go through a `node` TCP relay.
- Octopus refuses loopback Forgejo hosts and requires HTTPS, so the script serves Gitea
  on a private address with a generated CA and passes it as `NODE_EXTRA_CA_CERTS`.
- Gitea 28 needs the webhook target listed in `[security] ALLOWED_HOST_LIST`. `*` is not
  enough for a private address.

Windows notes:

- The checkout has CRLF line endings. Multi-line `sed` and string replaces miss unless
  they normalise line endings first.
- Pass paths containing `[integrationId]` to eslint with the brackets escaped.
- Five `apps/cli` tests fail on Windows on `master` too (install.sh lookup, file modes,
  wizard). They are unrelated to these branches.

## Suggested PR order

1. The six `fix/*` branches, in any order. Each body should say `Refs #933 (related bug N)`
   except the Gitea one.
2. `feat/gateway-settings-ui`.
3. `feat/gateway-base-url-path-prefix`, opened against `master` after step 2 merges, or
   as a stacked draft before that.
4. `feat/embeddings-base-url`.
5. `feat/bedrock-provider`. Say in the body that it is untested against real AWS and that
   1,397 of its added lines are `bun.lock`.

Upstream asks for Conventional Commits, a branch from `master`, and passing lint and
typecheck. The PR template has Summary, Changes and Test plan sections.

## Deployment notes for our own use

- LiteLLM route, no code needed beyond these fixes: set `ACP_BASE_URL` and `ACP_API_KEY`,
  use `acp:<model>` ids. Octopus sends no cache hints on this path.
- Native Bedrock route: set `AWS_REGION`, use `bedrock:<model or inference profile>` ids.
  This path keeps Anthropic prompt caching.
- Embeddings: Ollama, an OpenAI key, or `OCTOPUS_EMBED_BASE_URL` pointed at LiteLLM.
- Gitea: connect it as a Forgejo integration. Set `OCTOPUS_SELF_HOSTED=true`,
  `FORGEJO_ALLOWED_PRIVATE_ORIGINS` and, for an internal CA, `NODE_EXTRA_CA_CERTS`.
- Licence: modified MIT. The branding clause applies only above 10,000 monthly active
  users or 100,000 USD monthly revenue of the product using it.

## Live test results, 2026-11-15

Run from `D:/worktrees/octo-e2e` (branch `tmp/e2e`, all ten branches merged, local only, not pushed).

- Bedrock direct: `bedrock-live.test.ts` on `feat/bedrock-provider` passes against AWS. Second request read back the 4,018 tokens the first wrote to the cache.
- Gitea 28.1.0 (company instance): `gitea-live` harness passes with `GITEA_LIVE_SHARED=1` and `GITEA_LIVE_REPO=<owner>/octopus-live-test`. The mode is on `fix/gitea-webhook-headers`. Webhook receipt is not covered there, the server cannot reach a laptop.
- Full app: Postgres, Qdrant and LiteLLM in podman, `next dev` on port 43300. Forgejo card connected to the company Gitea, 74 repositories synced.
- Review through LiteLLM (`acp:claude-sonnet`, set in the new gateway model field) posted on the scratch PR. Embeddings went through `OCTOPUS_EMBED_BASE_URL` to Titan v2 (1024 dim).
- Review through `bedrock:us.anthropic.claude-sonnet-4-5-20250929-v1:0` posted one inline comment and a failed commit status. Usage row: 3,566 input, 1,610 output, 10,887 cache write.
- The pull_request deliveries in the full-app run were built from the real PR JSON and signed locally with the integration secret. Real Gitea deliveries are covered only by the disposable-container run.

Found while testing, none fixed:

- Connecting a Forgejo host queues an index job for every repository the account administers, with auto review on. 74 jobs were queued here. A deployment needs a dedicated account that administers only the intended repositories.
- Two-pass validation (`review-core.ts`, step 9) calls Haiku on the Anthropic API whatever the org model is. Without `ANTHROPIC_API_KEY` it logs an error and keeps all findings.
- No settings field accepts a `bedrock:` model id. `available_models` is empty on a fresh install, so the org default was set in the database.
- Gitea needs `write:user` to create a repository through `/user/repos`. The Forgejo card's scope list (`read:user`, `write:repository`, `write:issue`) is enough for reviews.
- `prisma migrate deploy` fails on an empty database at `20260419212831_add_jira_integration`. `prisma db push` works.
- Podman on this Windows box does not forward published ports to `localhost`. Use the VM address from `podman machine ssh "ip -4 -o addr show eth0"`.
- `scripts/gitea-live-test.sh` prefers docker when both are installed. Set `CONTAINER_RUNTIME=podman` here.
- A base URL with a path prefix was not exercised against LiteLLM.
