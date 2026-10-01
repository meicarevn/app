import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20261002000500_v4_014b_care_state_machine.sql";
const sql = readFileSync(migrationPath, "utf8");

describe("V4_014B commercial care state-machine contract", () => {
  it("is transactional and fail-closed on commercial RBAC prerequisites", () => {
    expect(sql.trimStart().toLowerCase()).toMatch(/^begin;/);
    expect(sql.trimEnd().toLowerCase()).toMatch(/commit;$/);
    expect(sql).toContain("V4_014B_SCOPED_PERMISSION_HELPER_MISSING");
    expect(sql).toContain("V4_014B_WORKFLOW_VIEW_PERMISSION_MISSING");
    expect(sql).toContain("V4_014B_WORKFLOW_MANAGE_PERMISSION_MISSING");
    expect(sql).not.toMatch(/insert\s+into\s+public\.permissions/i);
  });

  it("keeps canonical care data in private schema with RLS enabled", () => {
    const tables = [
      "care_policy_versions_v4",
      "care_signals_v4",
      "care_cases_v4",
      "care_case_events_v4",
      "care_case_verifications_v4"
    ];

    for (const table of tables) {
      expect(sql).toContain(`create table if not exists private.${table}`);
      expect(sql).toContain(`alter table private.${table} enable row level security`);
    }

    expect(sql).not.toMatch(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.care_/i);
  });

  it("allows only synthetic, de-identified, or aggregate signal classifications", () => {
    expect(sql).toContain("data_classification in ('SYNTHETIC','DEIDENTIFIED','AGGREGATE')");
    expect(sql).toContain("IDENTIFIABLE_CARE_DATA_NOT_ALLOWED");
    expect(sql).not.toMatch(/patient_name|customer_name|phone|email|address|date_of_birth/i);
  });

  it("encodes REJECT as a terminal decision without task, owner, SLA, action, verification, or close", () => {
    expect(sql).toContain("REJECT_MUST_NOT_CREATE_OWNER_OR_SLA");
    expect(sql).toMatch(/human_decision\s*<>\s*'REJECT'[\s\S]*?status\s*=\s*'REJECTED'/);
    expect(sql).toMatch(/status\s*=\s*'REJECTED'[\s\S]*?owner_membership_id\s+is\s+null[\s\S]*?due_at\s+is\s+null[\s\S]*?first_action_at\s+is\s+null[\s\S]*?verified_at\s+is\s+null[\s\S]*?closed_at\s+is\s+null/i);
  });

  it("requires Owner and SLA when a human ACCEPT creates work", () => {
    expect(sql).toContain("ACCEPT_REQUIRES_OWNER_AND_SLA");
    expect(sql).toMatch(/human_decision\s*<>\s*'ACCEPT'[\s\S]*?owner_membership_id\s+is\s+not\s+null[\s\S]*?due_at\s+is\s+not\s+null/i);
    expect(sql).toContain("CARE_OWNER_MUST_BE_ACTIVE_ORGANIZATION_MEMBER");
    expect(sql).toContain("CARE_DUE_AT_MUST_BE_FUTURE");
  });

  it("makes verification-before-close a database invariant", () => {
    expect(sql).toContain("CARE_VERIFICATION_REQUIRES_ACTION");
    expect(sql).toMatch(/status\s*<>\s*'CLOSED'[\s\S]*?first_action_at\s+is\s+not\s+null[\s\S]*?verified_at\s+is\s+not\s+null[\s\S]*?closed_at\s+is\s+not\s+null/i);
    expect(sql).toContain("first_action_at <= verified_at");
    expect(sql).toContain("verified_at <= closed_at");
  });

  it("uses append-only evidence records and explicit immutable triggers", () => {
    for (const table of [
      "care_policy_versions_v4",
      "care_signals_v4",
      "care_case_events_v4",
      "care_case_verifications_v4"
    ]) {
      expect(sql).toMatch(new RegExp(`before update or delete on private\\.${table}`, "i"));
    }
    expect(sql).toContain("CARE_APPEND_ONLY_RECORD_IMMUTABLE");
    expect(sql).not.toMatch(/care_case_events_v4\(id.*on delete cascade/i);
  });

  it("does not expose direct care-table mutation privileges", () => {
    expect(sql).toMatch(/revoke all on private\.care_cases_v4 from public, anon, authenticated, service_role/i);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|all)[^;]*private\.care_(policy|signals|cases|case_events|case_verifications)/i);
    expect(sql).toMatch(/grant select on private\.care_cases_v4 to authenticated, service_role/i);
  });

  it("keeps public RPC facades SECURITY INVOKER and privileged implementations private", () => {
    const publicFunctions = [
      "register_care_policy_v4",
      "register_care_case_v4",
      "decide_care_case_v4",
      "record_care_action_v4",
      "verify_close_care_case_v4"
    ];
    for (const name of publicFunctions) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?security invoker`, "i"));
    }

    expect(sql).toContain("V4_014B_PUBLIC_SECURITY_DEFINER_FORBIDDEN");
    expect(sql).not.toMatch(/create or replace function public\.[a-z0-9_]+\([^;]*?security definer/is);
  });

  it("separates backend ingestion from human mutation privileges", () => {
    expect(sql).toMatch(/grant execute on function public\.register_care_policy_v4[^;]*to service_role/i);
    expect(sql).toMatch(/grant execute on function public\.register_care_case_v4[^;]*to service_role/i);
    expect(sql).toMatch(/grant execute on function public\.decide_care_case_v4[^;]*to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.record_care_action_v4[^;]*to authenticated/i);
    expect(sql).toMatch(/grant execute on function public\.verify_close_care_case_v4[^;]*to authenticated/i);
  });

  it("uses existing scoped workflow permissions for read and manage paths", () => {
    expect(sql).toContain("'workflow.view'");
    expect(sql).toContain("'workflow.manage'");
    expect(sql).toContain("private.has_scoped_permission_v4");
    expect(sql).not.toMatch(/insert\s+into\s+public\.role_permissions/i);
  });

  it("exposes only security-invoker read models for the future commercial gateway", () => {
    expect(sql).toMatch(/create or replace view public\.care_queue_v4\s+with \(security_invoker = true\)/i);
    expect(sql).toMatch(/create or replace view public\.care_case_timeline_v4\s+with \(security_invoker = true\)/i);
    expect(sql).toContain("V4_014B_CARE_QUEUE_MUST_BE_SECURITY_INVOKER");
  });

  it("does not mutate inventory truth, cutover flags, DNS, or frontend readiness", () => {
    expect(sql).not.toMatch(/frontend_v4_ready\s*=\s*true/i);
    expect(sql).not.toMatch(/inventory_write_mode\s*=|alert_publish_mode\s*=|cutover_stage\s*=/i);
    expect(sql).not.toMatch(/update\s+public\.organization_runtime_v4/i);
    expect(sql).not.toMatch(/inventory_intelligence_v4\s+set/i);
  });
});
