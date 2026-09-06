import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routePath = "shadow-pages/functions/v4/shadow/intelligence-v4-011.ts";
const route = readFileSync(routePath, "utf8");

describe("V4_011D controlled Shadow read-path promotion", () => {
  it("uses the additive DB projection as semantic primary source", () => {
    expect(route).toContain("inventory_intelligence_multi_axis_v4_011");
    expect(route).toContain('read_path: "V4_011D_DB_PROJECTION"');
    expect(route).not.toContain("projectMultiAxisRows(");
  });

  it("preserves human JWT/RLS authorization and organization scope", () => {
    expect(route).toContain("getShadowAccess");
    expect(route).toContain('access.permissions.includes("inventory.view")');
    expect(route).toContain("access.organization_scope");
    expect(route).toContain("authorization: `Bearer ${token}`");
  });

  it("preserves GET-only fail-closed behavior and contains no mutation fetch", () => {
    expect(route).toContain('req.method !== "GET"');
    expect(route).toContain("METHOD_NOT_ALLOWED");
    expect(route).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
  });

  it("keeps service-role credentials out of the route", () => {
    expect(route).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role/i);
    expect(route).toContain("sb_publishable_");
  });

  it("preserves Shadow UI metadata compatibility", () => {
    expect(route).toContain('"drugs"');
    expect(route).toContain('"warehouses"');
    expect(route).toContain("drugById");
    expect(route).toContain("warehouseById");
    expect(route).toContain("approved_semantic_cohort");
    expect(route).toContain("human_review_recommendations");
  });
});
