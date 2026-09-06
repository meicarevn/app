import { HttpError } from "./lib";

export type MemberAdminCanaryMode = "OFF" | "V4_CANARY";

export type MemberAdminCanaryDecision = {
  enabled: boolean;
  mode: MemberAdminCanaryMode;
  endpoint: string | null;
  reason: "ENABLED" | "FLAG_OFF" | "ENDPOINT_NOT_APPROVED";
};

export function normalizeMemberAdminCanaryMode(value?: string | null): MemberAdminCanaryMode {
  return String(value || "OFF").trim().toUpperCase() === "V4_CANARY" ? "V4_CANARY" : "OFF";
}

export function isApprovedMemberAdminV4Endpoint(endpoint: string, supabaseUrl: string) {
  try {
    const target = new URL(endpoint);
    const project = new URL(supabaseUrl);
    return target.protocol === "https:"
      && target.origin === project.origin
      && target.pathname === "/functions/v1/meicare-member-admin-v4"
      && !target.search
      && !target.hash;
  } catch {
    return false;
  }
}

export function resolveMemberAdminCanary(
  modeValue: string | null | undefined,
  endpoint: string | null | undefined,
  supabaseUrl: string
): MemberAdminCanaryDecision {
  const mode = normalizeMemberAdminCanaryMode(modeValue);
  if (mode !== "V4_CANARY") return { enabled: false, mode, endpoint: null, reason: "FLAG_OFF" };
  if (!endpoint || !isApprovedMemberAdminV4Endpoint(endpoint, supabaseUrl)) {
    return { enabled: false, mode, endpoint: null, reason: "ENDPOINT_NOT_APPROVED" };
  }
  return { enabled: true, mode, endpoint, reason: "ENABLED" };
}

export function requireMemberAdminCanary(decision: MemberAdminCanaryDecision) {
  if (!decision.enabled || !decision.endpoint) {
    throw new HttpError(403, decision.reason === "FLAG_OFF" ? "MEMBER_ADMIN_V4_CANARY_DISABLED" : "MEMBER_ADMIN_V4_ENDPOINT_NOT_APPROVED");
  }
  return decision.endpoint;
}

export function memberAdminCanaryError(status: number, backendCode?: string | null) {
  if (status === 401) return "MEMBER_ADMIN_AUTH_REQUIRED";
  if (status === 403) return "MEMBER_ADMIN_PERMISSION_DENIED";
  if (status === 409) return backendCode || "MEMBER_ADMIN_CONFLICT";
  if (status >= 500) return "MEMBER_ADMIN_UPSTREAM_FAILED";
  return backendCode || `MEMBER_ADMIN_HTTP_${status}`;
}
