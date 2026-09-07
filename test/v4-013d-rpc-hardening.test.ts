import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260907163000_v4_013d_privileged_rpc_boundary.sql",
  "utf8"
);
const acceptance = readFileSync("scripts/v4-013d-db-acceptance.sql", "utf8");
const rollback = readFileSync("scripts/v4-013d-db-rollback.sql", "utf8");

const rpcNames = [
  "approve_par_proposals",
  "bootstrap_organization",
  "change_drug_code_v3",
  "commit_inventory_period_report",
  "commit_inventory_snapshot_v2",
  "provision_his_connection_v2",
  "refresh_inventory_risks",
  "refresh_par_proposals",
  "refresh_stock_position_alerts",
  "revoke_his_connection_v2",
  "update_action_status",
  "update_inventory_policy_settings",
  "upsert_stock_policies"
];

describe("V4_013D privileged RPC boundary", () => {
  it("moves exactly the audited 13 implementations into private", () => {
    for (const name of rpcNames) {
      expect(migration).toContain(`alter function public.${name}(`);
      expect(migration).toContain(`select private.${name}(`);
      expect(rollback).toContain(`alter function private.${name}(`);
    }
    expect(migration.match(/alter function public\.[a-z0-9_]+\([^;]+ set schema private;/g)).toHaveLength(13);
  });

  it("exposes only security-invoker facades with a fixed search path", () => {
    for (const name of rpcNames) {
      const start = migration.indexOf(`create function public.${name}(`);
      expect(start).toBeGreaterThan(-1);
      const end = migration.indexOf(";", start);
      const definition = migration.slice(start, end + 1);
      expect(definition).toContain("language sql security invoker set search_path = ''");
      expect(definition.toLowerCase()).not.toContain("security definer");
    }
  });

  it("rebuilds public and private ACLs without anonymous execution", () => {
    for (const name of rpcNames) {
      expect(migration).toContain(`revoke all on function private.${name}(`);
      expect(migration).toContain(`revoke all on function public.${name}(`);
      expect(migration).toContain(`grant execute on function private.${name}(`);
      expect(migration).toContain(`grant execute on function public.${name}(`);
    }
    expect(migration).not.toMatch(/grant execute on function (public|private)\.[^;]+ to anon/i);
  });

  it("preserves the six existing service-role call paths only", () => {
    const serviceGrants = migration.match(/grant execute on function public\.[^;]+ to authenticated, service_role;/g) ?? [];
    expect(serviceGrants).toHaveLength(6);
    for (const name of [
      "bootstrap_organization",
      "commit_inventory_period_report",
      "commit_inventory_snapshot_v2",
      "refresh_inventory_risks",
      "refresh_par_proposals",
      "refresh_stock_position_alerts"
    ]) {
      expect(serviceGrants.some((grant) => grant.includes(`public.${name}(`))).toBe(true);
    }
  });

  it("fails closed on drift and verifies both sides before commit", () => {
    expect(migration).toContain("V4_013D_RPC_MISSING");
    expect(migration).toContain("V4_013D_PRIVATE_COLLISION");
    expect(migration).toContain("V4_013D_POSTCONDITION_FAILED");
    expect(migration.trim().endsWith("commit;")).toBe(true);
    expect(acceptance).toContain("V4_013D_ACCEPTANCE_FAILED");
    expect(acceptance.trim().endsWith("rollback;")).toBe(true);
  });

  it("does not mutate data, RLS, readiness or cutover flags", () => {
    const lower = migration.toLowerCase();
    for (const forbidden of [
      "insert into ",
      "update public.",
      "delete from ",
      "create policy",
      "alter policy",
      "frontend_v4_ready",
      "inventory_write_mode",
      "alert_publication_mode"
    ]) {
      expect(lower).not.toContain(forbidden);
    }
  });
});
