import { mock } from "bun:test";
import assert from "node:assert/strict";

// The /api/acp/models route makes the server call the organization's gateway
// with its stored key, so every refusal must happen before that call.
let signedIn = true;
let orgCookie: string | undefined = "org_1";
let member: { role: string; scopes: string[] } | null = { role: "owner", scopes: [] };
const listed: unknown[] = [];
const lookups: unknown[] = [];
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => name === "current_org_id" && orgCookie ? { value: orgCookie } : undefined }),
}));
mock.module("@/lib/auth", () => ({ auth: { api: { getSession: async () => signedIn ? { user: { id: "user_1" } } : null } } }));
mock.module("@octopus/db", () => ({ prisma: { organizationMember: { findFirst: async ({ where }: { where: unknown }) => { lookups.push(where); return member; } } } }));
mock.module("@/lib/org-permissions", () => ({
  hasOrgPermission: (who: { role: string }, permission: string) => permission === "settings:manage" && who.role === "owner",
}));
mock.module("@/lib/providers/acp", () => ({
  listGatewayModels: async (orgId: string) => { listed.push(orgId); return { status: "ok", models: ["claude-sonnet-4-6", "gpt-5.5"] }; },
}));

const { GET } = await import("../../../app/api/acp/models/route");
const call = async () => { const response = await GET(); return [response.status, await response.json()]; };

signedIn = false;
assert.deepEqual(await call(), [401, { error: "Unauthorized" }]);
signedIn = true; orgCookie = undefined;
assert.deepEqual(await call(), [400, { error: "No active org" }]);
orgCookie = "org_1"; member = null;
assert.deepEqual(await call(), [403, { error: "Admin role required" }], "a non-member of the selected org is refused");
member = { role: "member", scopes: [] };
assert.deepEqual(await call(), [403, { error: "Admin role required" }]);
assert.deepEqual(listed, [], "no refusal reaches the gateway");

member = { role: "owner", scopes: [] };
assert.deepEqual(await call(), [200, { status: "ok", models: ["claude-sonnet-4-6", "gpt-5.5"] }]);
assert.deepEqual(listed, ["org_1"], "the listing is scoped to the selected organization");
assert.deepEqual(lookups.at(-1), { userId: "user_1", organizationId: "org_1", deletedAt: null });
console.log("acp models route checks passed");
