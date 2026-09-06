import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260906070000_v4_011b_additive_multi_axis_projection.sql",
  "utf8"
);

describe("V4_011B additive database projection migration", () => {
  it("is a security-invoker additive view", () => {
    expect(migration).toContain("create or replace view public.inventory_intelligence_multi_axis_v4_011");
    expect(migration).toContain("security_invoker = true");
    expect(migration.toLowerCase()).not.toContain("security definer");
  });

  it("does not mutate canonical inventory, alerts, or readiness", () => {
    const lower = migration.toLowerCase();
    for (const forbidden of [
      "insert into public.inventory_events",
      "update public.inventory_intelligence_v4",
      "delete from public.inventory_intelligence_v4",
      "update public.organization_runtime_v4",
      "insert into public.alerts",
      "update public.alerts"
    ]) {
      expect(lower).not.toContain(forbidden);
    }
  });

  it("keeps A1 recommendation semantics limited to the approved cohort", () => {
    expect(migration).toContain("c.stock_status = 'INSUFFICIENT_DATA'");
    expect(migration).toContain("'TRANSFER_REVIEW'");
    expect(migration).toContain("'PROCUREMENT_REVIEW'");
  });

  it("implements B1 TIME_WINDOW_ONLY suppression", () => {
    expect(migration).toContain("'TIME_WINDOW_ONLY'");
    expect(migration).toContain("suppress_expected_wastage_claims");
    expect(migration).toContain("supported_expiry_quantity_at_risk");
    expect(migration).toContain("supported_expiry_value_at_risk");
  });

  it("requires human review for every non-NONE recommendation", () => {
    expect(migration).toContain("(p.recommendation_state <> 'NONE') as recommendation_requires_human_review");
  });

  it("does not expose the additive view to anon", () => {
    expect(migration).toContain("revoke all on public.inventory_intelligence_multi_axis_v4_011 from anon");
    expect(migration).toContain("grant select on public.inventory_intelligence_multi_axis_v4_011 to authenticated");
  });
});
