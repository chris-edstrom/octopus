Title: fix(forgejo): accept Gitea webhook header names

## Summary

Gitea sends `X-Gitea-Signature` and `X-Gitea-Event`. It never sends the `X-Forgejo-*` names, so every delivery from a Gitea server was rejected with 401. The webhook route now falls back to the Gitea names. Forgejo deliveries are unchanged.

The PR also adds an opt-in live test that drives the real client and the real webhook route against a running Gitea.

## Testing

- `forgejo-webhook` harness: Forgejo and Gitea header variants.
- `scripts/gitea-live-test.sh` against a disposable Gitea 28.3.0 container (podman): connection, repository reads, pull request reads, comment and review publication, commit statuses, and 7 webhook deliveries sent by Gitea itself. The same run fails with 401 without the route change.
- `GITEA_LIVE_SHARED=1 GITEA_LIVE_REPO=<owner>/<repo>` against a company Gitea 28.1.0 with a token scoped `read:user`, `write:repository`, `write:issue`: all read and publication checks pass. Webhook receipt is skipped in this mode because that server cannot reach the test process.
- Full app (Postgres, Qdrant, `next dev`): the Forgejo card connected to the same Gitea 28.1.0 and synced its repositories. Two `pull_request` deliveries carrying only the `X-Gitea-*` headers were accepted, and each started a review that was posted back to the pull request. Those two deliveries were built from the real pull request JSON and signed locally with the integration secret, since the server cannot reach a laptop.

![Forgejo card connected to Gitea](https://raw.githubusercontent.com/chris-edstrom/octopus/handoff/notes/pr/img/forgejo-card-gitea.png)

![Review posted on the Gitea pull request](https://raw.githubusercontent.com/chris-edstrom/octopus/handoff/notes/pr/img/gitea-review-coverage.png)

Both live tests are skipped unless their environment variables are set, so the default suite stays hermetic.

## Notes

- Gitea requires `write:user` to create a repository through `/user/repos`. `GITEA_LIVE_REPO` lets the test use an existing repository so the token can stay narrow.
