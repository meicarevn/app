import { afterEach, describe, expect, it, vi } from "vitest";
import { inviteMember, setMemberStatus, type MemberAdminEnv } from "../src/member-admin";

const env: MemberAdminEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-public-key",
  MEMBER_ADMIN_FUNCTION_URL: "https://example.supabase.co/functions/v1/meicare-member-admin-v4"
};
const token = "eyJ-test-user-token-long-enough";
const org = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const warehouse = "00000000-0000-4000-8000-000000000003";

afterEach(() => vi.restoreAllMocks());

describe("V4 member administration client", () => {
  it("refuses OWNER invitation before network access", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(inviteMember(env, token, {
      organizationId: org,
      email: "owner@example.com",
      displayName: "Owner Two",
      roleCode: "OWNER",
      scopeType: "ORGANIZATION",
      reason: "Test owner invite"
    })).rejects.toThrow(/INVALID_INVITE_ROLE/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires a scope id for warehouse assignments", async () => {
    await expect(inviteMember(env, token, {
      organizationId: org,
      email: "warehouse@example.com",
      displayName: "Warehouse User",
      roleCode: "WAREHOUSE_STAFF",
      scopeType: "WAREHOUSE",
      reason: "Warehouse assignment"
    })).rejects.toThrow(/INVALID_SCOPE_ID/);
  });

  it("forwards only the user bearer token to the invite Edge Function", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "INVITED" }), {
      status: 201,
      headers: { "content-type": "application/json" }
    }));
    await inviteMember(env, token, {
      organizationId: org,
      email: "warehouse@example.com",
      displayName: "Warehouse User",
      roleCode: "WAREHOUSE_STAFF",
      scopeType: "WAREHOUSE",
      scopeId: warehouse,
      reason: "Bổ sung nhân sự Kho 1"
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${token}`);
    expect(JSON.stringify(init)).not.toContain("service_role");
    const payload = JSON.parse(String(init?.body));
    expect(payload.role_code).toBe("WAREHOUSE_STAFF");
    expect(payload.scope_id).toBe(warehouse);
  });

  it("routes lifecycle status changes through the V4 RPC using the same JWT", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "SUSPENDED" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    await setMemberStatus(env, token, {
      organizationId: org,
      membershipId: member,
      status: "SUSPENDED",
      reason: "Tạm ngưng công tác"
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/rest/v1/rpc/set_member_status_v4");
    expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      p_organization_id: org,
      p_membership_id: member,
      p_status: "SUSPENDED"
    });
  });
});
