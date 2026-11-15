import { mock } from "bun:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

// Drives the real Forgejo client and the real webhook route against a live Gitea
// server. Nothing here stubs HTTP: every read, every publication and the webhook
// delivery go over TLS to the instance named by GITEA_LIVE_URL. Only the database
// and the review pipeline behind the webhook are replaced. See
// scripts/gitea-live-test.sh for a disposable instance.
const host = new URL(process.env.GITEA_LIVE_URL!).origin;
const token = process.env.GITEA_LIVE_TOKEN!;
// GITEA_LIVE_HOOK_ORIGIN is the origin Gitea posts webhooks to in order to reach
// this process. It differs from loopback when Gitea runs in a container, and it
// may point at a relay; GITEA_LIVE_HOOK_PORT then pins the port listened on here.
const hookPort = Number(process.env.GITEA_LIVE_HOOK_PORT ?? 0);
process.env.OCTOPUS_SELF_HOSTED = "true";
process.env.FORGEJO_ALLOWED_PRIVATE_ORIGINS = host;
process.env.OCTOPUS_DATA_KEY = randomBytes(32).toString("hex");

mock.module("server-only", () => ({}));
mock.module("@/lib/review-attempt-outcome", () => ({ recordReviewAdmissionAfterCommit: () => {} }));
const reviews: Record<string, unknown>[] = [];
mock.module("@/lib/webhook-shared", () => ({ startReviewFlow: async (params: Record<string, unknown>) => {
  reviews.push(params);
  return { started: true, pullRequestId: "pr-live" };
} }));

const { encryptString } = await import("@/lib/crypto");
const organizationId = "org-live";
const integrationId = "integration-live";
const webhookSecret = randomBytes(24).toString("hex");
const integration = {
  id: integrationId, organizationId, forgejoHost: host, username: "", accessTokenEnc: encryptString(token),
  connectorTokenHash: null, connectorError: null, webhookSecret, organization: { bannedAt: null, deletedAt: null },
};
let repository: { id: number; fullName: string } | undefined;
const deliveries = new Set<string>();
const db = {
  forgejoIntegration: { findUnique: async ({ where }: { where: { id?: string; organizationId?: string } }) =>
    where.id === integrationId || where.organizationId === organizationId ? integration : null },
  repository: {
    findUnique: async ({ where }: { where: { id?: string; provider_externalId_organizationId?: { externalId: string } } }) => {
      if (!repository) return null;
      const externalId = `${host}:${repository.id}`;
      if (where.provider_externalId_organizationId && where.provider_externalId_organizationId.externalId !== externalId) return null;
      return { id: "repo-live", fullName: repository.fullName, provider: "forgejo", organizationId, externalId,
        isActive: true, autoReview: true, dismissedAt: null,
        organization: { bannedAt: null, deletedAt: null, forgejoIntegration: integration } };
    },
    updateMany: async () => ({ count: 1 }),
  },
  pullRequest: { updateMany: async () => ({ count: 1 }) },
  webhookDelivery: {
    findUnique: async ({ where }: { where: { provider_deliveryId: { deliveryId: string } } }) =>
      deliveries.has(where.provider_deliveryId.deliveryId) ? { id: "seen" } : null,
    upsert: async ({ create }: { create: { deliveryId: string } }) => { deliveries.add(create.deliveryId); },
  },
  $transaction: async (work: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)): Promise<unknown> =>
    Array.isArray(work) ? Promise.all(work) : work({ ...db, $queryRaw: async () => [{ acquired: true }] }),
};
mock.module("@octopus/db", () => ({ prisma: db }));

const { forgejoRequest } = await import("@/lib/forgejo-http");
const forgejo = await import("@/lib/forgejo");
const { POST } = await import("../../../app/api/forgejo/webhook/[integrationId]/route");

/** Setup and verification calls. They use the product's own transport, so TLS and host policy are exercised too. */
async function api<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  try {
    const response = await forgejoRequest(host, token, `/api/v1${path}`, { method, ...(body === undefined ? {} : { body }) });
    return (response.body ? JSON.parse(response.body) : undefined) as T;
  } catch (error) {
    throw new Error(`${method} ${path} failed`, { cause: error });
  }
}
async function until<T>(what: string, probe: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

type Delivery = { url: string; headers: Headers; raw: Buffer; status: number; body: { action?: string } };
const received: Delivery[] = [];
const route = (url: string, headers: Headers, raw: Buffer) => POST(new Request(url, { method: "POST", headers, body: raw }),
  { params: Promise.resolve({ integrationId: new URL(url).pathname.split("/").pop()! }) });
const server = Bun.serve({ hostname: "0.0.0.0", port: hookPort, async fetch(request) {
  const raw = Buffer.from(await request.arrayBuffer());
  const response = await route(request.url, request.headers, raw);
  received.push({ url: request.url, headers: request.headers, raw, status: response.status, body: JSON.parse(raw.toString("utf8")) });
  return response;
} });
const hookOrigin = (process.env.GITEA_LIVE_HOOK_ORIGIN ?? `http://127.0.0.1:${server.port}`).replace(/\/+$/, "");
const delivered = (event: string, action: string) => until(`${event}:${action} delivery`, () =>
  received.find(entry => entry.headers.get("x-gitea-event") === event && entry.body.action === action));

try {
  // ── Connection ────────────────────────────────────────────────────────────
  const { version } = await api<{ version: string }>("GET", "/version");
  const connection = await forgejo.validateForgejoConnection(host, token);
  assert.equal(connection.host, host);
  integration.username = connection.username;
  await assert.rejects(forgejo.validateForgejoConnection(host, "0".repeat(40)), "a wrong token must be refused");

  // ── Fixture: repository, webhook, feature branch, pull request ────────────
  const name = `octopus-live-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  const created = await api<{ id: number; full_name: string }>("POST", "/user/repos", { name, auto_init: true, default_branch: "main", private: false });
  repository = { id: created.id, fullName: created.full_name };
  const repoPath = `/repos/${created.full_name}`;
  await api("POST", `${repoPath}/hooks`, { type: "gitea", active: true, events: ["pull_request", "issue_comment"],
    config: { url: `${hookOrigin}/api/forgejo/webhook/${integrationId}`, content_type: "json", secret: webhookSecret } });
  const source = "export const answer = 41;\n// second line\n";
  await api("POST", `${repoPath}/contents/src/answer.ts`, { content: Buffer.from(source).toString("base64"), message: "add answer", new_branch: "feature" });
  const pull = await api<{ number: number; head: { sha: string } }>("POST", `${repoPath}/pulls`, { head: "feature", base: "main", title: "Add the answer" });

  // ── Repository reads ──────────────────────────────────────────────────────
  const listed = (await forgejo.listUserRepos(organizationId)).find(repo => repo.id === created.id);
  assert.equal(listed?.full_name, created.full_name);
  assert.equal(listed?.default_branch, "main");
  assert.equal(await forgejo.getBranchHead(organizationId, created.full_name, "feature"), pull.head.sha);
  await assert.rejects(forgejo.getBranchHead(organizationId, created.full_name, "no-such-branch"), { status: 404 });
  const tree = await forgejo.getRepositoryTree(organizationId, created.full_name, "feature");
  assert.deepEqual([...tree].sort(), ["README.md", "src/answer.ts"]);
  assert.equal(await forgejo.getFileContent(organizationId, created.full_name, "feature", "src/answer.ts"), source);
  assert.equal(await forgejo.getFileContent(organizationId, created.full_name, "main", "src/answer.ts"), "", "a missing file reads as empty");
  await assert.rejects(forgejo.getFileContent(organizationId, created.full_name, "main", "src/answer.ts", { strict: true }));

  // ── Pull request reads ────────────────────────────────────────────────────
  const details = await forgejo.getPullRequestDetails(organizationId, created.full_name, pull.number);
  assert.equal(details.number, pull.number);
  assert.equal(details.title, "Add the answer");
  assert.equal(details.headSha, pull.head.sha);
  assert.equal(details.author, connection.username);
  assert.deepEqual([details.state, details.draft, details.merged], ["open", false, false]);
  assert.ok(details.url.startsWith(`${host}/${created.full_name}/pulls/`));
  const { input, rawDiff } = await forgejo.getPullRequestReviewInput(organizationId, created.full_name, pull.number, pull.head.sha);
  assert.ok(rawDiff.includes("+export const answer = 41;"), "the diff carries the added line");
  assert.equal(input.headSha, pull.head.sha);
  assert.match(input.baseSha ?? "", /^[0-9a-f]{40,64}$/, "Gitea reports merge_base");
  assert.deepEqual([input.expectedFiles, input.inventoryComplete, input.files.length], [1, true, 1]);
  assert.equal(input.files[0].path, "src/answer.ts");
  assert.ok(input.files[0].patch?.includes("+export const answer = 41;"));
  await assert.rejects(forgejo.getPullRequestReviewInput(organizationId, created.full_name, pull.number, "f".repeat(40)), /revision changed/);

  // ── Publication ───────────────────────────────────────────────────────────
  const commentId = await forgejo.createPullRequestComment(organizationId, created.full_name, pull.number, "first body");
  await forgejo.updatePullRequestComment(organizationId, created.full_name, pull.number, commentId, "edited body");
  const comments = await api<{ id: number; body: string }[]>("GET", `${repoPath}/issues/${pull.number}/comments`);
  assert.equal(comments.find(comment => comment.id === commentId)?.body, "edited body");
  const reviewId = await forgejo.createPullRequestReview(organizationId, created.full_name, pull.number, "review summary",
    [{ path: "src/answer.ts", line: 1, side: "RIGHT", body: "should be 42" }]);
  const inlineId = await forgejo.createInlineComment(organizationId, created.full_name, pull.number, "src/answer.ts", 2, "inline note");
  const published = await api<{ id: number; body: string; commit_id: string }[]>("GET", `${repoPath}/pulls/${pull.number}/reviews`);
  assert.equal(published.find(review => review.id === reviewId)?.body, "review summary");
  assert.equal(published.find(review => review.id === reviewId)?.commit_id, pull.head.sha);
  for (const [id, line, body] of [[reviewId, 1, "should be 42"], [inlineId, 2, "inline note"]] as const) {
    const inline = await api<{ path: string; body: string; position: number }[]>("GET", `${repoPath}/pulls/${pull.number}/reviews/${id}/comments`);
    assert.deepEqual(inline.map(comment => [comment.path, comment.position, comment.body]), [["src/answer.ts", line, body]]);
  }
  // A review run pinned to an older head must refuse to publish.
  await assert.rejects(forgejo.runWithForgejoRepository("repo-live", () =>
    forgejo.createPullRequestReview(organizationId, created.full_name, pull.number, "stale", []), "e".repeat(40)), /revision changed/);
  for (const [state, expected] of [["running", "pending"], ["success", "success"], ["failed", "failure"], ["canceled", "error"]] as const) {
    await forgejo.setCommitStatus(organizationId, created.full_name, pull.head.sha, state, `octopus/${state}`, "live check", `${host}/`);
    const statuses = await api<{ context: string; status: string }[]>("GET", `${repoPath}/commits/${pull.head.sha}/statuses`);
    assert.equal(statuses.find(status => status.context === `octopus/${state}`)?.status, expected);
  }

  // ── Webhooks delivered by Gitea itself ────────────────────────────────────
  const opened = await delivered("pull_request", "opened");
  assert.equal(opened.status, 200);
  assert.match(opened.headers.get("x-gitea-signature") ?? "", /^[a-f0-9]{64}$/);
  // The reason the route needs the fallback: Gitea never sends the Forgejo names.
  assert.equal(opened.headers.get("x-forgejo-signature"), null);
  assert.equal(opened.headers.get("x-forgejo-event"), null);
  const automatic = await until("the automatic review", () => reviews.find(review => review.automatic === true));
  assert.deepEqual([automatic.provider, automatic.prNumber, automatic.headSha, automatic.prTitle, automatic.repoFullName],
    ["forgejo", pull.number, pull.head.sha, "Add the answer", created.full_name]);

  // A mention from another account starts a review; the bot's own comments never do.
  const before = reviews.length;
  await forgejo.createPullRequestComment(organizationId, created.full_name, pull.number, "/octopus review");
  const reviewer = `reviewer-${randomBytes(3).toString("hex")}`;
  await api("POST", "/admin/users", { username: reviewer, email: `${reviewer}@example.com`, password: randomBytes(18).toString("base64url"), must_change_password: false });
  const mention = await api<{ id: number }>("POST", `${repoPath}/issues/${pull.number}/comments?sudo=${reviewer}`, { body: "@octopus please review" });
  const requested = await until("the mention review", () => reviews.find(review => review.triggerCommentId === mention.id));
  assert.deepEqual([requested.automatic, requested.prNumber, requested.headSha, requested.prAuthor],
    [false, pull.number, pull.head.sha, connection.username]);
  assert.equal(reviews.length, before + 1, "only the other account's mention started a review");
  assert.ok(received.every(entry => entry.status === 200), `every Gitea delivery was accepted: ${received.map(entry => entry.status)}`);

  // A redelivery is byte-identical; the route must acknowledge it without a second review.
  const replay = await route(opened.url, opened.headers, opened.raw);
  assert.deepEqual([replay.status, await replay.json()], [200, { ok: true, duplicate: true }]);
  // A real Gitea delivery with one flipped body byte no longer matches its signature.
  const tampered = Buffer.from(opened.raw);
  tampered[tampered.length - 2] ^= 1;
  assert.equal((await route(opened.url, opened.headers, tampered)).status, 401);
  assert.equal(reviews.length, before + 1);
  console.log(`Gitea ${version} live checks passed (${received.length} webhook deliveries)`);
} finally {
  server.stop(true);
}
