import { prisma, scoped } from "@ronde/db";
import { enterprise } from "@/ee-bridge";
import { audit } from "@/lib/server/audit";
import type { WorkspaceSettings } from "@/lib/server/authz";
import { identityHost } from "@/lib/server/identity";
import { publicUrl } from "@/lib/server/public-url";
import { hashScimToken } from "@/lib/server/scim";

export const dynamic = "force-dynamic";

// SCIM 2.0 provisioning of a workspace (Enterprise): /api/scim/v2/<workspace>/Users…, with a bearer token
// created in the workspace's security settings

type Params = { params: Promise<{ ws: string; path?: string[] }> };

const scimJson = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/scim+json; charset=utf-8", "Cache-Control": "no-store" },
  });

const scimError = (status: number, detail: string) =>
  scimJson(status, { schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: String(status), detail });

async function handle(req: Request, { params }: Params): Promise<Response> {
  const { ws, path = [] } = await params;
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!bearer) return scimError(401, "A bearer token is required");
  const token = await prisma.scimToken.findUnique({
    where: { tokenHash: hashScimToken(bearer) },
    include: { workspace: { select: { id: true, slug: true, settings: true, plan: true, deletedAt: true, suspendedAt: true } } },
  });
  if (!token || token.workspace.slug !== ws || token.workspace.deletedAt) return scimError(401, "Unknown token");
  if (token.workspace.suspendedAt) return scimError(403, "This workspace is suspended");
  if (!(await identityHost.allowed("identity.scim", token.workspace.id)))
    return scimError(403, "SCIM provisioning is not part of this workspace's plan");
  // Used recently enough to show in the settings, without a write at every request
  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > 60_000)
    await prisma.scimToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });

  let body: unknown;
  if (req.method !== "GET" && req.method !== "DELETE") {
    try {
      body = await req.json();
    } catch {
      return scimError(400, "The body is not valid JSON");
    }
  }
  const db = scoped(prisma, token.workspace.id);
  let result: Awaited<ReturnType<typeof enterprise.scim.handle>>;
  try {
    result = await enterprise.scim.handle(db, token.workspace.id, {
      method: req.method,
      path,
      query: new URL(req.url).searchParams,
      body,
      baseUrl: await publicUrl(`/api/scim/v2/${ws}`),
    });
  } catch (e) {
    // Whatever went wrong, the directory gets an answer it reads
    console.error(`[scim] ${req.method} ${path.join("/")}`, e);
    return scimError(400, "The request could not be handled");
  }
  if (result.change) {
    // With its plan: the audit log is on for the plans that have it
    const workspace = {
      id: token.workspace.id,
      plan: token.workspace.plan,
      settings: (token.workspace.settings ?? {}) as WorkspaceSettings,
    };
    await audit({ workspace, user: { id: `scim:${token.id}`, name: `SCIM · ${token.name}`, email: "" } }, db, {
      action: result.change.action,
      targetType: "person",
      targetId: result.change.personId,
      data: { email: result.change.email },
    });
  }
  return scimJson(result.status, result.body);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
