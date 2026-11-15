import "server-only";
import { AiProviderFailure, rememberProviderRoute, type KeyOwner } from "../provider-failure";
import { prisma } from "@octopus/db";
import { decryptStringMaybeLegacy } from "@/lib/crypto";
import { readBoundedJson } from "@/lib/bounded-json";
import type { Provider, AiCreateParams, AiResponse } from "./index";
import { callOpenAiGateway, gatewayApiBase } from "./openai-gateway";
import { validateProviderUrl } from "./url-validation";

/**
 * ACPX — an OpenAI-compatible multi-vendor gateway (Agent Communication
 * Protocol). Configurable per-org (Organization.acpBaseUrl + acpApiKey),
 * which overrides the deployment-wide env default:
 *   ACP_BASE_URL — gateway origin (e.g. https://acpx.internal.example.com)
 *   ACP_API_KEY  — bearer token for the gateway
 * Model ids are namespaced "acp:<model>".
 *
 * The per-org key is stored encrypted at rest like the other BYOK keys, so it
 * is decrypted here before use. SSRF validation is applied only to the per-org
 * (org-admin supplied) base URL; the env-configured ACP_BASE_URL is operator-
 * controlled and may legitimately point at an internal host, so it is only
 * normalized to an origin (private ranges allowed).
 */
async function resolveConfig(orgId?: string | null): Promise<{ baseUrl: string; apiKey: string; keyOwner: KeyOwner } | null> {
  // Per-org config overrides the deployment env default.
  if (orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { acpBaseUrl: true, acpApiKey: true },
    });
    if (org?.acpBaseUrl && org?.acpApiKey) {
      return { baseUrl: validateProviderUrl(org.acpBaseUrl, { keepPath: true }), apiKey: decryptStringMaybeLegacy(org.acpApiKey), keyOwner: "organization" };
    }
  }
  const envBase = process.env.ACP_BASE_URL;
  const envKey = process.env.ACP_API_KEY;
  if (envBase && envKey) return { baseUrl: validateProviderUrl(envBase, { hosted: false, keepPath: true }), apiKey: envKey, keyOwner: "platform" };
  return null;
}

export const acpProvider: Provider = {
  name: "acp",
  supportsJsonSchema: true,
  async create(
    params: AiCreateParams,
    _apiKey?: string | null,
    orgId?: string | null,
  ): Promise<AiResponse> {
    const config = await resolveConfig(orgId);
    if (!config) {
      throw new Error(
        "ACPX is not configured — set ACP_BASE_URL and ACP_API_KEY, or " +
          "configure acpBaseUrl and acpApiKey on the organization.",
      );
    }
    try {
      return await callOpenAiGateway(params, {
        name: "acp",
        modelPrefix: "acp:",
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
      });
    } catch (error) {
      throw rememberProviderRoute(new AiProviderFailure(error, "acp", params.model, config.keyOwner), orgId,
        async () => JSON.stringify(await resolveConfig(orgId)) === JSON.stringify(config));
    }
  },
};

const MODEL_LIST_TIMEOUT_MS = 5000;
const MODEL_LIST_MAX_BYTES = 1024 * 1024;
const MODEL_LIST_MAX_MODELS = 500;
const MODEL_ID_MAX_LENGTH = 200;

export type GatewayModelList =
  | { status: "unconfigured" }
  | { status: "unavailable" }
  | { status: "ok"; models: string[] };

/**
 * Model ids served by the gateway (`GET <origin>[/prefix]/v1/models`), for the Settings
 * model picker. Resolves the gateway through the same path as reviews, so the
 * per-org URL gets the same SSRF validation and the API key stays server-side.
 * Many gateways do not serve /v1/models; any failure (rejected URL, timeout,
 * non-2xx, oversized or malformed body) returns "unavailable" so the UI falls
 * back to a free-form model id. Redirects are refused: a validated origin must
 * not be able to forward the bearer token to another host.
 */
export async function listGatewayModels(orgId?: string | null): Promise<GatewayModelList> {
  try {
    const config = await resolveConfig(orgId);
    if (!config) return { status: "unconfigured" };
    const res = await fetch(`${gatewayApiBase(config.baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(MODEL_LIST_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { status: "unavailable" };
    }
    const parsed = await readBoundedJson(res, MODEL_LIST_MAX_BYTES);
    const data = parsed.ok ? (parsed.value as { data?: unknown } | null)?.data : null;
    if (!Array.isArray(data)) return { status: "unavailable" };
    const ids = new Set<string>();
    for (const entry of data) {
      const id = (entry as { id?: unknown } | null)?.id;
      if (typeof id === "string" && id.trim() && id.length <= MODEL_ID_MAX_LENGTH) ids.add(id.trim());
      if (ids.size >= MODEL_LIST_MAX_MODELS) break;
    }
    return { status: "ok", models: [...ids].sort() };
  } catch {
    return { status: "unavailable" };
  }
}
