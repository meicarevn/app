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
  "/v4/shadow/compare/inventory": "inventory.view",
  "/v4/shadow/members": "membership.manage",
  "/v4/shadow/member-history": "membership.manage",
  "/v4/shadow/role-catalog": "membership.manage",
  "/v4/shadow/scopes": "membership.manage"
};

const ROUTE_CAPABILITIES: Record<string, string> = {
  "/v4/shadow/overview": "overview",
  "/v4/shadow/inventory": "inventory",
  "/v4/shadow/actions": "actions",
  "/v4/shadow/reconciliations": "reconciliations",
  "/v4/shadow/iot": "iot",
  "/v4/shadow/documents": "documents",
  "/v4/shadow/readiness": "readiness",
  "/v4/shadow/compare/inventory": "compare",
  "/v4/shadow/members": "member_admin",
  "/v4/shadow/member-history": "member_admin",
  "/v4/shadow/role-catalog": "member_admin",
  "/v4/shadow/scopes": "member_admin"
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
  organization_scope: boolean;
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
    select: "role_id,permission_id"
  });
  const permissionIds = [...new Set(mappings.map((row) => String(row.permission_id || "")).filter((value) => UUID_RE.test(value)))];
  const permissionRows = permissionIds.length ? await restRows(env, token, rid, "permissions", {
    id: inFilter(permissionIds),
    select: "id,code"
  }) : [];

  const permissionCodeById = new Map(
    permissionRows
      .map((row) => [String(row.id || ""), String(row.code || "")] as const)
      .filter(([id, code]) => UUID_RE.test(id) && Boolean(code))
  );
  const permissionsByRole = new Map<string, Set<string>>();
  for (const mapping of mappings) {
    const roleId = String(mapping.role_id || "");
    const permissionId = String(mapping.permission_id || "");
    const code = permissionCodeById.get(permissionId);
    if (!UUID_RE.test(roleId) || !code) continue;
    if (!permissionsByRole.has(roleId)) permissionsByRole.set(roleId, new Set());
    permissionsByRole.get(roleId)!.add(code);
  }

  const normalizedRoles = assignments.map((row) => ({
    role_id: String(row.role_id),
    role_code: String(row.role_code || "UNKNOWN"),
    role_name: String(row.role_name || row.role_code || "Unknown"),
    scope_type: String(row.scope_type || "ORGANIZATION").toUpperCase(),
    scope_id: row.scope_id == null ? null : String(row.scope_id)
  }));

  const roleHas = (roleId: string, permission: string) => permissionsByRole.get(roleId)?.has(permission) === true;
  const hasAny = (permission: string) => normalizedRoles.some((role) => roleHas(role.role_id, permission));
  const hasOrg = (permission: string) => normalizedRoles.some((role) => role.scope_type === "ORGANIZATION" && roleHas(role.role_id, permission));
  const hasOrgOrUnit = (permission: string) => normalizedRoles.some((role) => ["ORGANIZATION", "ORG_UNIT"].includes(role.scope_type) && roleHas(role.role_id, permission));
  const organizationScope = normalizedRoles.some((role) => role.scope_type === "ORGANIZATION");
  const permissions = [...new Set([...permissionsByRole.values()].flatMap((set) => [...set]))].sort();

  return {
    user_id: userId,
    organization_id: org,
    roles: normalizedRoles,
    permissions,
    capabilities: {
      overview: hasAny("inventory.view"),
      inventory: hasAny("inventory.view"),
      actions: hasAny("workflow.view"),
      reconciliations: hasOrg("reconciliation.view"),
      iot: hasAny("iot.view"),
      documents: hasOrgOrUnit("document.view"),
      document_sensitive: hasOrgOrUnit("document.sensitive_view"),
      compare: hasOrg("inventory.view"),
      readiness: hasOrg("organization.view"),
      member_admin: hasOrg("membership.manage")
    },
    organization_scope: organizationScope,
    scope_warning: !organizationScope
  };
}

export function enforceShadowRoute(pathname: string, access: ShadowAccess) {
  const required = ROUTE_PERMISSIONS[pathname];
  if (!required) return;
  if (!access.permissions.includes(required)) throw new HttpError(403, "SHADOW_PERMISSION_DENIED");
  const capability = ROUTE_CAPABILITIES[pathname];
  if (capability && access.capabilities[capability] !== true) {
    throw new HttpError(403, "SHADOW_SCOPE_DENIED");
  }
}
