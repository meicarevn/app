import { describe, expect, it } from "vitest";
import { enforceShadowRoute, type ShadowAccess } from "../src/shadow-access";

function access(permissions: string[]): ShadowAccess {
  return {
    user_id: "00000000-0000-4000-8000-000000000001",
    organization_id: "00000000-0000-4000-8000-000000000002",
    roles: [],
    permissions,
    capabilities: {},
    scope_warning: false
  };
}

describe("shadow route permission gate", () => {
  it("allows inventory views with inventory.view", () => {
    expect(() => enforceShadowRoute("/v4/shadow/inventory", access(["inventory.view"]))).not.toThrow();
    expect(() => enforceShadowRoute("/v4/shadow/compare/inventory", access(["inventory.view"]))).not.toThrow();
  });

  it("denies inventory route without inventory.view", () => {
    expect(() => enforceShadowRoute("/v4/shadow/inventory", access(["document.view"]))).toThrowError(/SHADOW_PERMISSION_DENIED/);
  });

  it("keeps domain permissions separate", () => {
    expect(() => enforceShadowRoute("/v4/shadow/reconciliations", access(["workflow.view"]))).toThrowError(/SHADOW_PERMISSION_DENIED/);
    expect(() => enforceShadowRoute("/v4/shadow/reconciliations", access(["reconciliation.view"]))).not.toThrow();
    expect(() => enforceShadowRoute("/v4/shadow/iot", access(["iot.view"]))).not.toThrow();
    expect(() => enforceShadowRoute("/v4/shadow/documents", access(["document.view"]))).not.toThrow();
  });

  it("does not invent a permission rule for unknown routes", () => {
    expect(() => enforceShadowRoute("/v4/shadow/not-a-real-route", access([]))).not.toThrow();
  });
});
