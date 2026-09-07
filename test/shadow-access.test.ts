import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceShadowRoute, listShadowOrganizations, type ShadowAccess } from "../src/shadow-access";

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "publishable-test-key"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function access(
  permissions: string[],
  capabilities: Record<string, boolean> = {},
  organizationScope = true
): ShadowAccess {
  return {
    user_id: "00000000-0000-4000-8000-000000000001",
    organization_id: "00000000-0000-4000-8000-000000000002",
    roles: [],
    permissions,
    capabilities,
    organization_scope: organizationScope,
    scope_warning: !organizationScope
  };
}

describe("shadow route permission and scope gate", () => {
  it("allows a scoped inventory route when the inventory capability is present", () => {
    expect(() => enforceShadowRoute(
      "/v4/shadow/inventory",
      access(["inventory.view"], { inventory: true }, false)
    )).not.toThrow();
  });

  it("denies inventory route without inventory.view", () => {
    expect(() => enforceShadowRoute(
      "/v4/shadow/inventory",
      access(["document.view"], { inventory: true })
    )).toThrowError(/SHADOW_PERMISSION_DENIED/);
  });

  it("keeps organization-only reconciliation summary unavailable to scoped-only roles", () => {
    expect(() => enforceShadowRoute(
      "/v4/shadow/reconciliations",
      access(["reconciliation.view"], { reconciliations: false }, false)
    )).toThrowError(/SHADOW_SCOPE_DENIED/);
    expect(() => enforceShadowRoute(
      "/v4/shadow/reconciliations",
      access(["reconciliation.view"], { reconciliations: true }, true)
    )).not.toThrow();
  });

  it("keeps Production Gate and V3↔V4 comparison organization-scope only", () => {
    expect(() => enforceShadowRoute(
      "/v4/shadow/readiness",
      access(["organization.view"], { readiness: false }, false)
    )).toThrowError(/SHADOW_SCOPE_DENIED/);
    expect(() => enforceShadowRoute(
      "/v4/shadow/compare/inventory",
      access(["inventory.view"], { compare: false }, false)
    )).toThrowError(/SHADOW_SCOPE_DENIED/);
  });

  it("allows scoped workflow and IoT reads when their capabilities are present", () => {
    expect(() => enforceShadowRoute(
      "/v4/shadow/actions",
      access(["workflow.view"], { actions: true }, false)
    )).not.toThrow();
    expect(() => enforceShadowRoute(
      "/v4/shadow/iot",
      access(["iot.view"], { iot: true }, false)
    )).not.toThrow();
  });

  it("keeps member administration organization-scope and membership.manage only", () => {
    expect(() => enforceShadowRoute(
      "/v4/shadow/members",
      access(["membership.manage"], { member_admin: true }, true)
    )).not.toThrow();
    expect(() => enforceShadowRoute(
      "/v4/shadow/members",
      access(["membership.manage"], { member_admin: false }, false)
    )).toThrowError(/SHADOW_SCOPE_DENIED/);
    expect(() => enforceShadowRoute(
      "/v4/shadow/members",
      access(["membership.view"], { member_admin: true }, true)
    )).toThrowError(/SHADOW_PERMISSION_DENIED/);
  });

  it("does not invent a permission rule for unknown routes", () => {
    expect(() => enforceShadowRoute("/v4/shadow/not-a-real-route", access([]))).not.toThrow();
  });
});

describe("commercial organization resolver", () => {
  it("returns only active organizations visible through the caller's RLS session", async () => {
    const userId = "00000000-0000-4000-8000-000000000001";
    const orgA = "00000000-0000-4000-8000-000000000002";
    const orgB = "00000000-0000-4000-8000-000000000003";
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer user-token");
      if (url.endsWith("/auth/v1/user")) return Response.json({ id: userId });
      if (url.includes("/rest/v1/membership_effective_roles_v4")) {
        expect(url).toContain(`user_id=eq.${userId}`);
        expect(url).toContain("is_current=eq.true");
        return Response.json([
          { organization_id: orgA, role_code: "PHARMACY_ADMIN" },
          { organization_id: orgA, role_code: "VIEWER" },
          { organization_id: orgB, role_code: "VIEWER" }
        ]);
      }
      if (url.includes("/rest/v1/organizations")) {
        expect(url).toContain("active=eq.true");
        return Response.json([
          { id: orgB, code: "BV-B", name: "Bệnh viện B" },
          { id: orgA, code: "BV-A", name: "Bệnh viện A" }
        ]);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://platform.example/v4/shadow/organizations", {
      headers: { authorization: "Bearer user-token" }
    });
    await expect(listShadowOrganizations(request, env, "rid-organizations")).resolves.toEqual([
      { id: orgA, code: "BV-A", name: "Bệnh viện A", roles: ["PHARMACY_ADMIN", "VIEWER"] },
      { id: orgB, code: "BV-B", name: "Bệnh viện B", roles: ["VIEWER"] }
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns an empty list when the user has no current assignment", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/auth/v1/user")) {
        return Response.json({ id: "00000000-0000-4000-8000-000000000001" });
      }
      if (url.includes("/rest/v1/membership_effective_roles_v4")) return Response.json([]);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://platform.example/v4/shadow/organizations", {
      headers: { authorization: "Bearer user-token" }
    });
    await expect(listShadowOrganizations(request, env, "rid-empty")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
