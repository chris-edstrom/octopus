import { afterEach, beforeEach, expect, it, mock } from "bun:test";

let org: { acpBaseUrl: string | null; acpApiKey: string | null } | null = null;
mock.module("server-only", () => ({}));
mock.module("@octopus/db", () => ({ prisma: { organization: { findUnique: async () => org } } }));
mock.module("@/lib/crypto", () => ({ decryptStringMaybeLegacy: (value: string) => `decrypted-${value}` }));

const { listGatewayModels } = await import("../providers/acp");

const originalFetch = globalThis.fetch;
const env = { base: process.env.ACP_BASE_URL, key: process.env.ACP_API_KEY, selfHosted: process.env.SELF_HOSTED };
let calls: { url: string; init: RequestInit | undefined }[] = [];
const respond = (reply: () => Response | Promise<Response>) => {
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return reply();
  }) as unknown as typeof fetch;
};

beforeEach(() => {
  org = null; calls = [];
  delete process.env.ACP_BASE_URL; delete process.env.ACP_API_KEY; delete process.env.SELF_HOSTED;
  respond(() => Response.json({ data: [] }));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [name, value] of [["ACP_BASE_URL", env.base], ["ACP_API_KEY", env.key], ["SELF_HOSTED", env.selfHosted]] as const) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

it("reports an unconfigured gateway without calling out", async () => {
  expect(await listGatewayModels("org_1")).toEqual({ status: "unconfigured" });
  org = { acpBaseUrl: "https://gateway.example.com", acpApiKey: null };
  expect(await listGatewayModels("org_1")).toEqual({ status: "unconfigured" });
  expect(calls).toEqual([]);
});

it("lists env-gateway models from the origin's /v1/models and returns ids only", async () => {
  process.env.ACP_BASE_URL = "http://localhost:4000/some/path?x=1";
  process.env.ACP_API_KEY = "env-secret";
  respond(() => Response.json({ object: "list", data: [{ id: "gpt-5.5" }, { id: "claude-sonnet-4-6", owned_by: "x" }, { id: "gpt-5.5" }, { id: 7 }, {}, null, { id: "x".repeat(201) }] }));
  const result = await listGatewayModels(null);
  expect(result).toEqual({ status: "ok", models: ["claude-sonnet-4-6", "gpt-5.5"] });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.url).toBe("http://localhost:4000/v1/models");
  expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer env-secret");
  expect(calls[0]!.init?.redirect).toBe("error");
  expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  expect(JSON.stringify(result)).not.toContain("env-secret");
});

it("prefers the per-org gateway and decrypts its key server-side", async () => {
  process.env.ACP_BASE_URL = "http://localhost:4000";
  process.env.ACP_API_KEY = "env-secret";
  org = { acpBaseUrl: "https://gateway.example.com/v1", acpApiKey: "stored" };
  respond(() => Response.json({ data: [{ id: "m1" }] }));
  expect(await listGatewayModels("org_1")).toEqual({ status: "ok", models: ["m1"] });
  expect(calls[0]!.url).toBe("https://gateway.example.com/v1/models");
  expect(new Headers(calls[0]!.init?.headers).get("authorization")).toBe("Bearer decrypted-stored");
});

it("applies the provider's SSRF validation to a per-org URL before any request", async () => {
  for (const acpBaseUrl of ["http://169.254.169.254", "http://localhost:4000", "file:///etc/passwd", "not a url"]) {
    org = { acpBaseUrl, acpApiKey: "stored" };
    expect(await listGatewayModels("org_1")).toEqual({ status: "unavailable" });
  }
  expect(calls).toEqual([]);
});

it("degrades to unavailable when the gateway does not serve a usable model list", async () => {
  process.env.ACP_BASE_URL = "https://gateway.example.com";
  process.env.ACP_API_KEY = "env-secret";
  const replies: (() => Response | Promise<Response>)[] = [
    () => new Response("Not Found", { status: 404 }),
    () => new Response("unauthorized", { status: 401 }),
    () => new Response("<html>", { status: 200 }),
    () => Response.json({ models: ["a"] }),
    () => Response.json(null),
    () => new Response(JSON.stringify({ data: [{ id: "x".repeat(1024 * 1024) }] })),
    () => { throw new TypeError("fetch failed"); },
    () => { throw new DOMException("timed out", "TimeoutError"); },
  ];
  for (const reply of replies) {
    respond(reply);
    expect(await listGatewayModels(null)).toEqual({ status: "unavailable" });
  }
});

it("caps the number of listed models", async () => {
  process.env.ACP_BASE_URL = "https://gateway.example.com";
  process.env.ACP_API_KEY = "env-secret";
  respond(() => Response.json({ data: Array.from({ length: 600 }, (_, i) => ({ id: `m${i}` })) }));
  const result = await listGatewayModels(null);
  expect(result.status === "ok" && result.models.length).toBe(500);
});
