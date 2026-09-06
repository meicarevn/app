import { HttpError } from "./lib";

export type ShadowAccessEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};

type Row = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ROUTE_PERMISSIONS: Record<string, string> = {
  "/v4/shadow/overview": "inventory.view",
  "/v4/shadow/inventory": "inventory.view",
  "/v4/shadow/actions": "workflow.view",
  "/v4/shadow/reconciliations": "reconciliation.view",
  "/v4/shadow/iot": "iot.view",
  "/v4/shadow/documents": "document.view",
  "/v4/shadow/readiness": "organization.view",
  "/v4/shadow/compare/inventory": "inventory.view"
};

export type ShadowAccess = {
  user_id: string;
  organization_id: string;
  roles: Array<{
    role_id: string;
    role_code: string;
    role_name: string;
    scope_type: string;
    scope_id: string | null;
  }>;
  permissions: string[];
  capabilities: Record<string, boolean>;
  scope_warning: boolean;
};

function bearer(req: Request) {
  const value = req.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

export function shadowOrganizationId(req: Request, url: URL) {
  const value = (url.searchParams.get("organization_id") || req.headers.get("x-organization-id") || "").trim();
  if (!UUID_RE.test(value)) throw new HttpError(400, "ORGANIZATION_ID_REQUIRED");
  return value;
}

async function authenticatedUser(req: Request, env: ShadowAccessEnv, rid: string) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "UNAUTHORIZED");
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      "x-request-id": rid
    }
  });
  if (!response.ok) throw new HttpError(401, "UNAUTHORIZED");
  const user = await response.json() as { id?: unknown };
  if (typeof user.id !== "string") throw new HttpError(401, "UNAUTHORIZED");
  return { token, userId: user.id };
}

async function restRows(
  env: ShadowAccessEnv,
  token: string,
  rid: string,
  table: string,
  params: Record<string, string>
): Promise<Row[]> {
  const url = new URL(`${env.SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-request-id": rid
    }
  });
  if (!response.ok) {
    console.error(JSON.stringify({ event: "shadow_access_read_failed", table, status: response.status, request_id: rid }));
    throw new HttpError(response.status === 401 || response.status === 403 ? response.status : 502, "SHADOW_ACCESS_READ_FAILED");
  }
  return await response.json() as Row[];
}

function inFilter(values: string[]) {
  return `in.(${values.join(",")})`;
}

export async function getShadowAccess(req: Request, env: ShadowAccessEnv, rid: string, org: string): Promise<ShadowAccess> {
  const { token, userId } = await authenticatedUser(req, env, rid);
  const assignments = await restRows(env, token, rid, "membership_effective_roles_v4", {
    organization_id: `eq.${org}`,
    user_id: `eq.${userId}`,
    is_current: "eq.true",
    select: "role_id,role_code,role_name,scope_type,scope_id"
  });

  if (!assignments.length) throw new HttpError(403, "NO_ACTIVE_ORGANIZATION_ROLE");

  const roleIds = [...new Set(assignments.map((row) => String(row.role_id || "")).filter((value) => UUID_RE.test(value)))];
  if (!roleIds.length) throw new HttpError(403, "NO_ACTIVE_ORGANIZATION_ROLE");

  const mappings = await restRows(env, token, rid, "role_permissions", {
    role_id: inFilter(roleIds),
    select: "permission_id"
  });
  const permissionIds = [...new Set(mappings.map((row) => String(row.permission_id || "")).filter((value) => UUID_RE.test(value)))];
  const permissionRows = permissionIds.length ? await restRows(env, token, rid, "permissions", {
    id: inFilter(permissionIds),
    select: "code"
  }) : [];
  const permissions = [...new Set(permissionRows.map((row) => String(row.code || "")).filter(Boolean))].sort();
  const has = (permission: string) => permissions.includes(permission);

  return {
    user_id: userId,
    organization_id: org,
    roles: assignments.map((row) => ({
      role_id: String(row.role_id),
      role_code: String(row.role_code || "UNKNOWN"),
      role_name: String(row.role_name || row.role_code || "Unknown"),
      scope_type: String(row.scope_type || "ORGANIZATION"),
      scope_id: row.scope_id == null ? null : String(row.scope_id)
    })),
    permissions,
    capabilities: {
      overview: has("inventory.view"),
      inventory: has("inventory.view"),
      actions: has("workflow.view"),
      reconciliations: has("reconciliation.view"),
      iot: has("iot.view"),
      documents: has("document.view"),
      document_sensitive: has("document.sensitive_view"),
      compare: has("inventory.view"),
      readiness: has("organization.view")
    },
    scope_warning: assignments.some((row) => String(row.scope_type || "ORGANIZATION") !== "ORGANIZATION")
  };
}

export function enforceShadowRoute(pathname: string, access: ShadowAccess) {
  const required = ROUTE_PERMISSIONS[pathname];
  if (!required) return;
  if (!access.permissions.includes(required)) throw new HttpError(403, "SHADOW_PERMISSION_DENIED");
}
