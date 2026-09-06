import { describe, expect, it } from "vitest";
import {
  isApprovedMemberAdminV4Endpoint,
  memberAdminCanaryError,
  requireMemberAdminCanary,
  resolveMemberAdminCanary,
} from "../src/member-admin-canary";

const supabaseUrl = "https://sgxufmcsnveyyddazwuk.supabase.co";
const v4 = `${supabaseUrl}/functions/v1/meicare-member-admin-v4`;

describe("V4 member-admin canary routing", () => {
  it("is OFF by default", () => {
    expect(resolveMemberAdminCanary(undefined, v4, supabaseUrl)).toMatchObject({
      enabled: false,
      mode: "OFF",
      reason: "FLAG_OFF",
    });
  });

  it("accepts only the exact V4 Edge Function on the same Supabase origin", () => {
    expect(isApprovedMemberAdminV4Endpoint(v4, supabaseUrl)).toBe(true);
    expect(isApprovedMemberAdminV4Endpoint(`${supabaseUrl}/functions/v1/meicare-member-admin`, supabaseUrl)).toBe(false);
    expect(isApprovedMemberAdminV4Endpoint("https://evil.example/functions/v1/meicare-member-admin-v4", supabaseUrl)).toBe(false);
    expect(isApprovedMemberAdminV4Endpoint(`${v4}?redirect=1`, supabaseUrl)).toBe(false);
    expect(isApprovedMemberAdminV4Endpoint("http://sgxufmcsnveyyddazwuk.supabase.co/functions/v1/meicare-member-admin-v4", supabaseUrl)).toBe(false);
  });

  it("enables V4 only with explicit flag and approved endpoint", () => {
    const decision = resolveMemberAdminCanary("V4_CANARY", v4, supabaseUrl);
    expect(decision).toMatchObject({ enabled: true, mode: "V4_CANARY", reason: "ENABLED" });
    expect(requireMemberAdminCanary(decision)).toBe(v4);
  });

  it("fails closed instead of silently falling back to legacy writes", () => {
    const decision = resolveMemberAdminCanary("V4_CANARY", `${supabaseUrl}/functions/v1/meicare-member-admin`, supabaseUrl);
    expect(decision.reason).toBe("ENDPOINT_NOT_APPROVED");
    expect(() => requireMemberAdminCanary(decision)).toThrow(/MEMBER_ADMIN_V4_ENDPOINT_NOT_APPROVED/);
  });

  it("normalizes 401/403 without exposing upstream details", () => {
    expect(memberAdminCanaryError(401, "jwt expired internal detail")).toBe("MEMBER_ADMIN_AUTH_REQUIRED");
    expect(memberAdminCanaryError(403, "permission internals")).toBe("MEMBER_ADMIN_PERMISSION_DENIED");
    expect(memberAdminCanaryError(500, "stack trace")).toBe("MEMBER_ADMIN_UPSTREAM_FAILED");
  });
});
