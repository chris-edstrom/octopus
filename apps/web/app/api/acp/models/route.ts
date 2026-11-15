import { headers, cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { prisma } from "@octopus/db";
import { hasOrgPermission } from "@/lib/org-permissions";
import { listGatewayModels } from "@/lib/providers/acp";

/**
 * GET /api/acp/models
 *
 * Model ids served by the caller's OpenAI-compatible gateway (per-org
 * acpBaseUrl/acpApiKey, else ACP_BASE_URL/ACP_API_KEY), for the Settings >
 * Models picker. Admin-only: the request makes the server call the gateway
 * with the org's key, and only admins can change the model anyway. The
 * response carries model ids only, never the base URL or the key.
 */
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const cookieStore = await cookies();
  const currentOrgId = cookieStore.get("current_org_id")?.value;
  if (!currentOrgId) return Response.json({ error: "No active org" }, { status: 400 });

  const member = await prisma.organizationMember.findFirst({
    where: { userId: session.user.id, organizationId: currentOrgId, deletedAt: null },
    select: { role: true, scopes: true },
  });
  if (!member || !hasOrgPermission(member, "settings:manage")) {
    return Response.json({ error: "Admin role required" }, { status: 403 });
  }

  return Response.json(await listGatewayModels(currentOrgId));
}
