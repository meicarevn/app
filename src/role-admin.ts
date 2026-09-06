import { HttpError } from "./lib";

export type RoleScopeType = "ORGANIZATION" | "ORG_UNIT" | "WAREHOUSE";

export type RoleAdminEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
};

export type RoleScopeCatalogRow = {
  role_id: string;
  role_code: string;
  role_name: string;
  system_role: boolean;
  default_scope: RoleScopeType;
  scope_type: RoleScopeType;
};

export type MembershipRoleAssignmentRow = {
  assignment_id: string;
  membership_id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  member_status: string;
  legacy_role: string;
  role_id: string;
  role_code: string;
  role_name: string;
  scope_type: RoleScopeType;
  scope_id: string | null;
  scope_code: string | null;
  scope_name: string | null;
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  assigned_by: string | null;
  created_at: string;
};

export type AssignMembershipRoleInput = {
  organizationId: string;
  membershipId: string;
  roleCode: string;
  scopeType?: RoleScopeType | null;
  scopeId?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  reason?: string | null;
};

export type EndMembershipRoleInput = {
  organizationId: string;
  assignmentId: string;
  endAt?: string | null;
  reason?: string | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[A-Z][A-Z0-9_]*$/;

function requireUuid(value: string, code: string) {
  if (!UUID_RE.test(value)) throw new HttpError(400, code);
  return value;
}

function requireToken(token: string) {
  if (!token || token.length < 16) throw new HttpError(401, "UNAUTHORIZED");
  return token;
}

function normalizeRoleCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!ROLE_RE.test(code)) throw new HttpError(400, "INVALID_ROLE_CODE");
  return code;
}

function normalizeScope(scopeType?: RoleScopeType | null, scopeId?: string | null) {
  if (!scopeType) return { scopeType: null, scopeId: null };
  if (!(["ORGANIZATION", "ORG_UNIT", "WAREHOUSE"] as const).includes(scopeType)) {
    throw new HttpError(400, "INVALID_SCOPE_TYPE");
  }
  if (scopeType === "ORGANIZATION") {
    if (scopeId) throw new HttpError(400, "ORGANIZATION_SCOPE_ID_MUST_BE_NULL");
    return { scopeType, scopeId: null };
  }
  if (!scopeId) throw new HttpError(400, "SCOPE_ID_REQUIRED");
  return { scopeType, scopeId: requireUuid(scopeId, "INVALID_SCOPE_ID") };
}

async function rpc<T>(
  env: RoleAdminEnv,
  token: string,
  fn: string,
  body: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${requireToken(token)}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    console.warn(JSON.stringify({ event: "role_admin_rpc_failed", fn, status: response.status }));
    throw new HttpError(
      response.status === 401 || response.status === 403 ? response.status : 502,
      "ROLE_ADMIN_RPC_FAILED"
    );
  }

  if (response.status === 204) return null as T;
  return await response.json() as T;
}

export async function listRoleScopeCatalog(
  env: RoleAdminEnv,
  token: string,
  organizationId: string
) {
  return rpc<RoleScopeCatalogRow[]>(env, token, "list_role_scope_catalog_v4", {
    p_organization_id: requireUuid(organizationId, "INVALID_ORGANIZATION_ID")
  });
}

export async function listMembershipRoleAssignments(
  env: RoleAdminEnv,
  token: string,
  organizationId: string
) {
  return rpc<MembershipRoleAssignmentRow[]>(env, token, "list_membership_role_assignments_v4", {
    p_organization_id: requireUuid(organizationId, "INVALID_ORGANIZATION_ID")
  });
}

export async function assignMembershipRole(
  env: RoleAdminEnv,
  token: string,
  input: AssignMembershipRoleInput
) {
  const scope = normalizeScope(input.scopeType, input.scopeId);
  return rpc<string>(env, token, "assign_membership_role_v4", {
    p_organization_id: requireUuid(input.organizationId, "INVALID_ORGANIZATION_ID"),
    p_membership_id: requireUuid(input.membershipId, "INVALID_MEMBERSHIP_ID"),
    p_role_code: normalizeRoleCode(input.roleCode),
    p_scope_type: scope.scopeType,
    p_scope_id: scope.scopeId,
    p_valid_from: input.validFrom ?? null,
    p_valid_to: input.validTo ?? null,
    p_reason: input.reason?.trim() || null
  });
}

export async function endMembershipRole(
  env: RoleAdminEnv,
  token: string,
  input: EndMembershipRoleInput
) {
  return rpc<string>(env, token, "end_membership_role_v4", {
    p_organization_id: requireUuid(input.organizationId, "INVALID_ORGANIZATION_ID"),
    p_assignment_id: requireUuid(input.assignmentId, "INVALID_ASSIGNMENT_ID"),
    p_end_at: input.endAt ?? null,
    p_reason: input.reason?.trim() || null
  });
}
