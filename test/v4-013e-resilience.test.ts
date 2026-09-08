import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const baseline = readFileSync("scripts/v4-013e-recovery-baseline.sql", "utf8");
const acceptance = readFileSync("scripts/v4-013e-recovery-acceptance.sql", "utf8");
const capture = readFileSync("scripts/v4-013e-capture-backup.sh", "utf8");
const restore = readFileSync("scripts/v4-013e-restore-drill.sh", "utf8");
const runbook = readFileSync("docs/V4_013E_RESILIENCE_AND_RECOVERY.md", "utf8");
const incident = readFileSync("docs/V4_013E_INCIDENT_RESPONSE.md", "utf8");

describe("V4_013E resilience and recovery gate", () => {
  it("keeps baseline and restore acceptance read-only", () => {
    for (const sql of [baseline, acceptance]) {
      expect(sql).toContain("set transaction read only");
      expect(sql.trim().endsWith("rollback;")).toBe(true);
      expect(sql.toLowerCase()).not.toMatch(/\b(insert|update|delete|truncate)\b/);
    }
  });

  it("fingerprints canonical data, runtime, schema and RLS", () => {
    for (const marker of [
      "public.inventory_events",
      "public.inventory_snapshot_lines",
      "public.drug_lots",
      "public.organization_runtime_v4",
      "schema', 'functions",
      "schema', 'rls_policies",
      "api_tables_without_rls"
    ]) {
      expect(baseline).toContain(marker);
    }
  });

  it("uses the official three-part Supabase dump and encrypts it", () => {
    expect(capture.match(/supabase db dump/g)).toHaveLength(5);
    expect(capture).toContain("--role-only");
    expect(capture).toContain("--data-only");
    expect(capture).toContain("age --recipient");
    expect(capture).toContain("sha256sum");
    expect(capture).toContain("Database changed during the logical backup window");
    expect(capture).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("refuses a restore target that can resolve to production", () => {
    expect(restore).toContain('"$SOURCE_PROJECT_REF" == "$RESTORE_PROJECT_REF"');
    expect(restore).toContain('"$RESTORE_DATABASE_URL" == *"$SOURCE_PROJECT_REF"*');
    expect(restore).toContain("Encrypted backup checksum mismatch");
    expect(restore).toContain("Backup archive contains unexpected paths");
    expect(restore).toContain("diff -u");
    expect(restore).toContain("result=DB_CHECKS_PASS");
    expect(restore).toContain("commercial_recovery_gate=BLOCKED_PENDING_OBJECT_AUTH_RTO_REVIEW");
  });

  it("does not claim a drill or recovery objective before evidence exists", () => {
    expect(runbook).toContain("PACKAGE READY / RESTORE DRILL BLOCKED");
    expect(runbook).toContain("backup_restore_verified_at` must remain `NULL");
    expect(runbook).toContain("An objective is not an SLA");
    expect(runbook).toContain("database-only backup cannot pass");
  });

  it("defines containment, recovery and evidence for incidents", () => {
    for (const marker of [
      "SEV-1",
      "incident commander",
      "Preserve logs",
      "known-good",
      "Minimum incident evidence"
    ]) {
      expect(incident).toContain(marker);
    }
  });
});
