import { describe, expect, it } from "vitest";
import { enforceShadowRoute, type ShadowAccess } from "../src/shadow-access";

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

  it("does not invent a permission rule for unknown routes", () => {
    expect(() => enforceShadowRoute("/v4/shadow/not-a-real-route", access([]))).not.toThrow();
  });
});
