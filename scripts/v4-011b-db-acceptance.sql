-- V4_011B post-migration read-only acceptance checks.
-- Run only after the additive view is installed in an approved environment.
-- Expected current production cohort snapshot is documented in Issue #25.

with v as (
  select *
  from public.inventory_intelligence_multi_axis_v4_011
  where organization_id = '68d83220-4e5d-46e7-8bd3-7863205985f4'::uuid
),
keys as (
  select warehouse_id, drug_id, count(*) as n
  from v
  group by warehouse_id, drug_id
),
a1 as (
  select * from v
  where legacy_v4_stock_status = 'INSUFFICIENT_DATA'
    and coalesce(usable_quantity, 0) <= 0
),
b1 as (
  select * from v
  where legacy_v4_stock_status = 'EXPIRY_RISK'
),
truth as (
  select
    count(*) as rows,
    sum(quantity_on_hand) as qoh_sum
  from public.inventory_intelligence_v4
  where organization_id = '68d83220-4e5d-46e7-8bd3-7863205985f4'::uuid
),
drift as (
  select count(*) as rows
  from public.inventory_ledger_drift_v4
  where organization_id = '68d83220-4e5d-46e7-8bd3-7863205985f4'::uuid
)
select jsonb_build_object(
  'rows', (select count(*) from v),
  'duplicate_operational_keys', (select count(*) from keys where n <> 1),
  'quantity_on_hand_sum', (select sum(quantity_on_hand) from v),
  'truth_rows', (select rows from truth),
  'truth_quantity_on_hand_sum', (select qoh_sum from truth),
  'a1_total', (select count(*) from a1),
  'a1_transfer', (select count(*) from a1 where recommendation_state = 'TRANSFER_REVIEW'),
  'a1_procurement', (select count(*) from a1 where recommendation_state = 'PROCUREMENT_REVIEW'),
  'a1_out_of_stock', (select count(*) from a1 where availability_state = 'OUT_OF_STOCK'),
  'a1_insufficient_evidence', (select count(*) from a1 where evidence_state = 'INSUFFICIENT_DATA'),
  'b1_total', (select count(*) from b1),
  'b1_critical', (select count(*) from b1 where expiry_state = 'CRITICAL'),
  'b1_high', (select count(*) from b1 where expiry_state = 'HIGH'),
  'b1_warning', (select count(*) from b1 where expiry_state = 'WARNING'),
  'b1_time_window_only', (select count(*) from b1 where expiry_evidence_mode = 'TIME_WINDOW_ONLY'),
  'b1_wastage_suppressed', (select count(*) from b1 where suppress_expected_wastage_claims),
  'b1_supported_quantity_null', (select count(*) from b1 where supported_expiry_quantity_at_risk is null),
  'b1_supported_value_null', (select count(*) from b1 where supported_expiry_value_at_risk is null),
  'actionable_without_human_review', (select count(*) from v where recommendation_state <> 'NONE' and not recommendation_requires_human_review),
  'ledger_drift_rows', (select rows from drift)
) as acceptance;

-- Current expected snapshot:
-- rows = 2244
-- duplicate_operational_keys = 0
-- quantity_on_hand_sum = truth_quantity_on_hand_sum = 4953566
-- A1 = 284 = 39 TRANSFER_REVIEW + 245 PROCUREMENT_REVIEW
-- A1 OUT_OF_STOCK = 284; A1 INSUFFICIENT_DATA evidence = 284
-- B1 = 19 = 3 CRITICAL + 4 HIGH + 12 WARNING
-- B1 TIME_WINDOW_ONLY = 19
-- B1 expected-wastage claims suppressed = 19
-- actionable_without_human_review = 0
-- ledger_drift_rows = 0
