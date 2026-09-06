import { handleShadowRead } from "../../../../src/shadow";
import { HttpError, requestId } from "../../../../src/lib";

type Env = Record<string, never>;
type PagesContext = { request: Request; env: Env };
type RoleRow = {
  role_id?: string;
  role_code?: string;
  role_name?: string;
  scope_type?: string;
  scope_id?: string | null;
};

const SUPABASE_URL = "https://sgxufmcsnveyyddazwuk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_9xbWYiMtnriBmFwuiGp8Qw_FNTB8NFc";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(req: Request) {
  const header = req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

function organizationId(req: Request, url: URL) {
  const value = (url.searchParams.get("organization_id") || req.headers.get("x-organization-id") || "").trim();
  if (!UUID_RE.test(value)) throw new HttpError(400, "ORGANIZATION_ID_REQUIRED");
  return value;
}

async function verifyUser(req: Request, rid: string) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "UNAUTHORIZED");
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      "x-request-id": rid
    }
  });
  if (!response.ok) throw new HttpError(401, "UNAUTHORIZED");
  const body = await response.json() as { id?: unknown };
  if (typeof body.id !== "string" || !UUID_RE.test(body.id)) throw new HttpError(401, "UNAUTHORIZED");
  return { token, userId: body.id };
}

async function getRoles(token: string, rid: string, org: string, userId: string): Promise<RoleRow[]> {
  const url = new URL(`${SUPABASE_URL}/rest/v1/membership_effective_roles_v4`);
  url.searchParams.set("organization_id", `eq.${org}`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("is_current", "eq.true");
  url.searchParams.set("select", "assignment_id,membership_id,organization_id,user_id,role_id,role_code,role_name,scope_type,scope_id,valid_from,valid_to");
  const response = await fetch(url.toString(), {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-request-id": rid
    }
  });
  if (!response.ok) throw new HttpError(response.status === 401 || response.status === 403 ? response.status : 502, "SHADOW_SESSION_FAILED");
  return await response.json() as RoleRow[];
}

async function getPermissions(token: string, rid: string, roleIds: string[]) {
  if (!roleIds.length) return new Set<string>();
  const url = new URL(`${SUPABASE_URL}/rest/v1/role_permissions`);
  url.searchParams.set("role_id", `in.(${roleIds.join(",")})`);
  url.searchParams.set("select", "role_id,permissions(code)");
  const response = await fetch(url.toString(), {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-request-id": rid
    }
  });
  if (!response.ok) throw new HttpError(response.status === 401 || response.status === 403 ? response.status : 502, "SHADOW_SESSION_FAILED");
  const rows = await response.json() as Array<{ permissions?: { code?: unknown } | Array<{ code?: unknown }> | null }>;
  const permissions = new Set<string>();
  for (const row of rows) {
    const embedded = Array.isArray(row.permissions) ? row.permissions : row.permissions ? [row.permissions] : [];
    for (const permission of embedded) if (typeof permission.code === "string") permissions.add(permission.code);
  }
  return permissions;
}

function hasOrgScope(roles: RoleRow[]) {
  return roles.some((role) => role.scope_type === "ORGANIZATION");
}

function capabilities(permissions: Set<string>, orgScope: boolean) {
  return {
    overview: permissions.has("inventory.view"),
    inventory: permissions.has("inventory.view"),
    actions: permissions.has("workflow.view"),
    reconciliations: permissions.has("reconciliation.view"),
    iot: permissions.has("iot.view"),
    documents: permissions.has("document.view"),
    compare: permissions.has("inventory.view") && orgScope,
    readiness: permissions.has("organization.view") && orgScope,
    member_admin: permissions.has("membership.manage") && orgScope
  };
}

function requiredPermission(pathname: string): string | null {
  if (pathname === "/v4/shadow/overview" || pathname === "/v4/shadow/inventory") return "inventory.view";
  if (pathname === "/v4/shadow/actions") return "workflow.view";
  if (pathname === "/v4/shadow/reconciliations") return "reconciliation.view";
  if (pathname === "/v4/shadow/iot") return "iot.view";
  if (pathname === "/v4/shadow/documents") return "document.view";
  if (pathname === "/v4/shadow/readiness") return "organization.view";
  if (pathname === "/v4/shadow/compare/inventory") return "inventory.view";
  return null;
}

function requiresOrgScope(pathname: string) {
  return pathname === "/v4/shadow/readiness" || pathname === "/v4/shadow/compare/inventory";
}

function json(body: unknown, status: number, rid: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-request-id": rid
    }
  });
}

async function handle(context: PagesContext) {
  const req = context.request;
  const rid = requestId(req);
  try {
    if (req.method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED");
    const url = new URL(req.url);
    const org = organizationId(req, url);
    const { token, userId } = await verifyUser(req, rid);
    const roles = await getRoles(token, rid, org, userId);
    const roleIds = [...new Set(roles.map((role) => role.role_id).filter((value): value is string => typeof value === "string" && UUID_RE.test(value)))];
    const permissions = await getPermissions(token, rid, roleIds);
    const orgScope = hasOrgScope(roles);

    if (url.pathname === "/v4/shadow/session") {
      return json({
        mode: "SHADOW",
        user_id: userId,
        organization_id: org,
        roles,
        permissions: [...permissions].sort(),
        capabilities: capabilities(permissions, orgScope),
        scope_warning: !orgScope
      }, 200, rid);
    }

    const required = requiredPermission(url.pathname);
    if (!required) throw new HttpError(404, "SHADOW_ROUTE_NOT_FOUND");
    if (!permissions.has(required)) throw new HttpError(403, "SHADOW_PERMISSION_DENIED");
    if (requiresOrgScope(url.pathname) && !orgScope) throw new HttpError(403, "SHADOW_SCOPE_DENIED");

    const response = await handleShadowRead(req, { SUPABASE_URL, SUPABASE_ANON_KEY }, rid);
    return json(response, 200, rid);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.code, request_id: rid }, error.status, rid);
    console.error(JSON.stringify({ event: "v4_010_shadow_preview_failed", request_id: rid }));
    return json({ error: "SHADOW_PREVIEW_FAILED", request_id: rid }, 500, rid);
  }
}

export const onRequest = handle;
