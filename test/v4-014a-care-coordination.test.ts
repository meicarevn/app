import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enforceShadowRoute, type ShadowAccess } from "../src/shadow-access";
import { handleShadowRead } from "../src/shadow";

const organizationId = "68d83220-4e5d-46e7-8bd3-7863205985f4";
const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "publishable-test-key"
};

function access(permissions: string[], capabilities: Record<string, boolean>): ShadowAccess {
  return {
    user_id: "00000000-0000-4000-8000-000000000001",
    organization_id: organizationId,
    roles: [],
    permissions,
    capabilities,
    organization_scope: false,
    scope_warning: true
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("V4_014A care coordination read layer", () => {
  it("reuses workflow.view and allows scoped care reads without organization-wide elevation", () => {
    expect(() => enforceShadowRoute(
      "/v4/shadow/care",
      access(["workflow.view"], { care: true })
    )).not.toThrow();

    expect(() => enforceShadowRoute(
      "/v4/shadow/care",
      access(["inventory.view"], { care: true })
    )).toThrowError(/SHADOW_PERMISSION_DENIED/);
  });

  it("reads only explicit CARE sources through the caller JWT and omits raw free-form fields", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/auth/v1/user") {
        return Response.json({ id: "00000000-0000-4000-8000-000000000001" });
      }

      if (url.pathname === "/rest/v1/action_center_v4") {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer user-token");
        expect(url.searchParams.get("organization_id")).toBe(`eq.${organizationId}`);
        expect(url.searchParams.get("source_type")).toBe("in.(CARE_SIGNAL,CARE_CASE,CARE_FOLLOWUP)");
        expect(url.searchParams.get("status")).toBe("eq.OPEN");
        expect(url.searchParams.get("priority")).toBe("eq.P1");

        const select = url.searchParams.get("select") || "";
        expect(select).toContain("reason_code");
        expect(select).toContain("recommended_action");
        expect(select).not.toContain("description");
        expect(select).not.toContain("metadata");

        return new Response(JSON.stringify([{
          organization_id: organizationId,
          item_kind: "CARE",
          item_id: "case-1",
          source_type: "CARE_CASE",
          source_id: "CARE-001",
          title: "Tác vụ chăm sóc",
          priority: "P1",
          status: "OPEN",
          reason_code: "CARE_WINDOW",
          recommended_action: "Liên hệ xác minh",
          due_at: "2026-10-03T09:00:00Z"
        }]), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-range": "0-0/1"
          }
        });
      }

      throw new Error(`Unexpected fetch: ${url.toString()}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request(
      `https://shadow.example/v4/shadow/care?organization_id=${organizationId}&status=open&priority=p1`,
      { headers: { authorization: "Bearer user-token" } }
    );

    const result = await handleShadowRead(request, env, "rid-care") as Record<string, unknown>;
    expect(result.kind).toBe("care");
    expect(result.organization_id).toBe(organizationId);
    expect(result.total).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects filter grammar outside a bounded uppercase token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "00000000-0000-4000-8000-000000000001"
    })));

    const request = new Request(
      `https://shadow.example/v4/shadow/care?organization_id=${organizationId}&status=OPEN,or(true)`,
      { headers: { authorization: "Bearer user-token" } }
    );

    await expect(handleShadowRead(request, env, "rid-care-filter")).rejects.toMatchObject({
      status: 400,
      code: "INVALID_CARE_FILTER"
    });
  });

  it("exposes a Vietnamese-first care queue without mutation controls", () => {
    const html = readFileSync("web-shadow/index.html", "utf8");
    const app = readFileSync("web-shadow/app.js", "utf8");

    expect(html).toContain('data-view="care"');
    expect(html).toContain("Hàng đợi chăm sóc");
    expect(app).toContain('api("/v4/shadow/care"');
    expect(app).toContain("không hiển thị raw metadata");
    expect(app).not.toMatch(/\/v4\/shadow\/care[^\n]*(POST|PATCH|DELETE)/);
  });
});
