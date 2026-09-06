import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assignMembershipRole,
  endMembershipRole,
  listMembershipRoleAssignments,
  listRoleScopeCatalog
} from "../src/role-admin";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key"
};
const token = "user-access-token-that-is-long-enough";
const org = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const assignment = "00000000-0000-4000-8000-000000000003";
const warehouse = "00000000-0000-4000-8000-000000000004";

afterEach(() => vi.restoreAllMocks());

function mockJson(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
}

describe("role admin user-JWT contract", () => {
  it("lists role scope options with the user token and anon key only", async () => {
    const fetchMock = mockJson([]);
    await listRoleScopeCatalog(env, token, org);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/rest/v1/rpc/list_role_scope_catalog_v4");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("apikey")).toBe(env.SUPABASE_ANON_KEY);
    expect(JSON.stringify(init)).not.toContain("service_role");
  });

  it("lists role assignments through the governed RPC", async () => {
    const fetchMock = mockJson([]);
    await listMembershipRoleAssignments(env, token, org);
    expect(String(fetchMock.mock.calls[0][0])).toContain("list_membership_role_assignments_v4");
  });

  it("normalizes role code and sends warehouse scope explicitly", async () => {
    const fetchMock = mockJson(assignment);
    await assignMembershipRole(env, token, {
      organizationId: org,
      membershipId: member,
      roleCode: "warehouse_staff",
      scopeType: "WAREHOUSE",
      scopeId: warehouse,
      reason: "Phân công kho"
    });
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(payload.p_role_code).toBe("WAREHOUSE_STAFF");
    expect(payload.p_scope_type).toBe("WAREHOUSE");
    expect(payload.p_scope_id).toBe(warehouse);
    expect(payload.p_reason).toBe("Phân công kho");
  });

  it("rejects a scope id on ORGANIZATION scope before any network call", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(assignMembershipRole(env, token, {
      organizationId: org,
      membershipId: member,
      roleCode: "AUDITOR",
      scopeType: "ORGANIZATION",
      scopeId: warehouse
    })).rejects.toThrow(/ORGANIZATION_SCOPE_ID_MUST_BE_NULL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires a scope id for ORG_UNIT / WAREHOUSE assignments", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(assignMembershipRole(env, token, {
      organizationId: org,
      membershipId: member,
      roleCode: "PHARMACIST",
      scopeType: "WAREHOUSE"
    })).rejects.toThrow(/SCOPE_ID_REQUIRED/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ends an assignment through end_membership_role_v4 instead of deleting a row", async () => {
    const fetchMock = mockJson(assignment);
    await endMembershipRole(env, token, {
      organizationId: org,
      assignmentId: assignment,
      reason: "Điều chuyển nhân sự"
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/rest/v1/rpc/end_membership_role_v4");
    expect(String(url)).not.toContain("membership_roles?");
    const payload = JSON.parse(String(init?.body));
    expect(payload.p_assignment_id).toBe(assignment);
    expect(payload.p_reason).toBe("Điều chuyển nhân sự");
  });
});
