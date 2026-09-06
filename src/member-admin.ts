import { HttpError } from "./lib";
import type { RoleScopeType } from "./role-admin";

export type MemberAdminEnv = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  MEMBER_ADMIN_FUNCTION_URL: string;
};

export type MemberAdminRow = {
  membership_id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  member_status: "INVITED" | "ACTIVE" | "SUSPENDED" | "DISABLED";
  legacy_role: string;
  department_id: string | null;
  department_name: string | null;
  invited_at: string | null;
  activated_at: string | null;
  joined_at: string;
  ended_at: string | null;
  status_changed_at: string;
  status_reason: string | null;
  current_roles: Array<{
    assignment_id: string;
    role_code: string;
    role_name: string;
    scope_type: RoleScopeType;
    scope_id: string | null;
    valid_from: string;
    valid_to: string | null;
  }>;
};

export type MemberLifecycleHistoryRow = {
  audit_id: number;
  action: string;
  membership_id: string;
  actor_user_id: string | null;
  actor_membership_id: string | null;
  reason: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
};

export type InviteMemberInput = {
  organizationId: string;
  email: string;
  displayName: string;
  roleCode: string;
  scopeType: RoleScopeType;
  scopeId?: string | null;
  departmentId?: string | null;
  reason: string;
};

export type SetMemberStatusInput = {
  organizationId: string;
  membershipId: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  reason: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const ROLE_RE = /^[A-Z][A-Z0-9_]*$/;

function requireToken(token: string) {
  if (!token || token.length < 16) throw new HttpError(401, "UNAUTHORIZED");
  return token;
}

function requireUuid(value: string, code: string) {
  if (!UUID_RE.test(value)) throw new HttpError(400, code);
  return value;
}

function requireReason(value: string) {
  const reason = value.trim();
  if (reason.length < 3 || reason.length > 1000) throw new HttpError(400, "AUDIT_REASON_REQUIRED");
  return reason;
}

function normalizeRole(value: string) {
  const role = value.trim().toUpperCase();
  if (!ROLE_RE.test(role) || role === "OWNER") throw new HttpError(400, "INVALID_INVITE_ROLE");
  return role;
}

async function rpc<T>(
  env: MemberAdminEnv,
  token: string,
  fn: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${requireToken(token)}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    console.warn(JSON.stringify({ event: "member_admin_rpc_failed", fn, status: res.status }));
    throw new HttpError(res.status === 401 || res.status === 403 ? res.status : 502, "MEMBER_ADMIN_RPC_FAILED");
  }
  if (res.status === 204) return null as T;
  return await res.json() as T;
}

export async function listMembers(env: MemberAdminEnv, token: string, organizationId: string) {
  return rpc<MemberAdminRow[]>(env, token, "list_member_admin_v4", {
    p_organization_id: requireUuid(organizationId, "INVALID_ORGANIZATION_ID")
  });
}

export async function listMemberHistory(
  env: MemberAdminEnv,
  token: string,
  organizationId: string,
  membershipId?: string | null
) {
  return rpc<MemberLifecycleHistoryRow[]>(env, token, "list_member_lifecycle_history_v4", {
    p_organization_id: requireUuid(organizationId, "INVALID_ORGANIZATION_ID"),
    p_membership_id: membershipId ? requireUuid(membershipId, "INVALID_MEMBERSHIP_ID") : null
  });
}

export async function activateMyInvitations(env: MemberAdminEnv, token: string) {
  return rpc<Array<{ membership_id: string; organization_id: string; status: string }>>(
    env,
    token,
    "activate_my_invited_memberships_v4",
    {}
  );
}

export async function inviteMember(env: MemberAdminEnv, token: string, input: InviteMemberInput) {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "INVALID_EMAIL");
  if (!displayName || displayName.length > 160) throw new HttpError(400, "INVALID_DISPLAY_NAME");
  if (!(["ORGANIZATION", "ORG_UNIT", "WAREHOUSE"] as const).includes(input.scopeType)) {
    throw new HttpError(400, "INVALID_SCOPE_TYPE");
  }
  const scopeId = input.scopeType === "ORGANIZATION"
    ? null
    : requireUuid(input.scopeId || "", "INVALID_SCOPE_ID");
  if (input.scopeType === "ORGANIZATION" && input.scopeId) throw new HttpError(400, "ORGANIZATION_SCOPE_ID_MUST_BE_NULL");

  const res = await fetch(env.MEMBER_ADMIN_FUNCTION_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${requireToken(token)}`,
      "content-type": "application/json",
      "x-request-id": crypto.randomUUID()
    },
    body: JSON.stringify({
      action: "invite",
      organization_id: requireUuid(input.organizationId, "INVALID_ORGANIZATION_ID"),
      email,
      display_name: displayName,
      role_code: normalizeRole(input.roleCode),
      scope_type: input.scopeType,
      scope_id: scopeId,
      department_id: input.departmentId ? requireUuid(input.departmentId, "INVALID_DEPARTMENT_ID") : null,
      reason: requireReason(input.reason)
    })
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    throw new HttpError(res.status, typeof body.error === "string" ? body.error : "MEMBER_INVITE_FAILED");
  }
  return body;
}

export async function setMemberStatus(
  env: MemberAdminEnv,
  token: string,
  input: SetMemberStatusInput
) {
  if (!(["ACTIVE", "SUSPENDED", "DISABLED"] as const).includes(input.status)) {
    throw new HttpError(400, "INVALID_MEMBER_STATUS");
  }
  return rpc<Record<string, unknown>>(env, token, "set_member_status_v4", {
    p_organization_id: requireUuid(input.organizationId, "INVALID_ORGANIZATION_ID"),
    p_membership_id: requireUuid(input.membershipId, "INVALID_MEMBERSHIP_ID"),
    p_status: input.status,
    p_reason: requireReason(input.reason)
  });
}
