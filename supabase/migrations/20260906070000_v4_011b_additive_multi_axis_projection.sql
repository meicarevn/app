-- V4_011B — additive database multi-axis inventory intelligence projection
-- REVIEW-ONLY until a separate Founder A production approval is recorded.
-- This migration does not mutate inventory truth, rewrite stock_status, publish alerts,
-- or change runtime/frontend readiness.

create or replace view public.inventory_intelligence_multi_axis_v4_011
with (security_invoker = true)
as
with base as (
  select
    ii.*,
    sum(greatest(coalesce(ii.usable_quantity, 0), 0)) over (
      partition by ii.organization_id, ii.drug_id
    ) as organization_usable_quantity
  from public.inventory_intelligence_v4 ii
),
classified as (
  select
    b.*,
    case
      when coalesce(b.usable_quantity, 0) <= 0 then 'OUT_OF_STOCK'
      when b.stock_status = 'OVERSTOCK' then 'OVERSTOCK'
      when b.stock_status = 'CRITICAL' then 'CRITICAL'
      when b.stock_status in ('REORDER', 'DEFAULT_LOW_STOCK', 'LOW_STOCK') then 'REORDER'
      when b.stock_status = 'INSUFFICIENT_DATA'
        and b.reference_stock is null
        and b.approved_min_stock is null
        and b.approved_reorder_point is null
        and b.approved_target_stock is null
        then 'INSUFFICIENT_REFERENCE'
      else 'HEALTHY'
    end as availability_state,
    case
      when upper(coalesce(b.highest_expiry_risk, '')) in ('CRITICAL', 'HIGH', 'WARNING')
        then upper(b.highest_expiry_risk)
      when coalesce(b.near_expiry_quantity, 0) > 0 or b.stock_status = 'EXPIRY_RISK'
        then 'WARNING'
      else 'NONE'
    end as expiry_state,
    (b.forecast_daily_demand is null and b.last_true_issue_at is null) as demand_evidence_missing
  from base b
),
projected as (
  select
    c.*,
    case
      when c.demand_evidence_missing then 'INSUFFICIENT_DATA'
      when c.expiry_state <> 'NONE'
        and (c.expiry_quantity_at_risk is null or c.expiry_value_at_risk is null)
        then 'LIMITED'
      else 'SUFFICIENT'
    end as evidence_state,
    case
      when c.expiry_state = 'NONE' then 'NONE'
      when c.demand_evidence_missing then 'TIME_WINDOW_ONLY'
      else 'DEMAND_SUPPORTED'
    end as expiry_evidence_mode,
    case
      -- Founder B-approved A1 cohort only. Do not generalize transfer/procurement
      -- recommendations to every legacy OUT_OF_STOCK row without a separate gate.
      when c.stock_status = 'INSUFFICIENT_DATA' and coalesce(c.usable_quantity, 0) <= 0 then
        case
          when c.organization_usable_quantity > 0 then 'TRANSFER_REVIEW'
          else 'PROCUREMENT_REVIEW'
        end
      -- Founder B-approved B1: direct expiry evidence may drive FEFO review even
      -- when expected-wastage inference is unsupported.
      when c.expiry_state <> 'NONE' then 'FEFO_REVIEW'
      else 'NONE'
    end as recommendation_state
  from classified c
)
select
  p.organization_id,
  p.warehouse_id,
  p.drug_id,
  p.analytics_run_id,

  p.quantity_on_hand,
  p.usable_quantity,
  p.quantity_reserved,
  p.quantity_quarantined,
  p.quantity_rejected,
  p.expired_quantity,
  p.near_expiry_quantity,
  p.inventory_value,
  p.unpriced_lot_count,
  p.organization_usable_quantity,

  p.forecast_daily_demand,
  p.demand_pattern,
  p.demand_confidence_level,
  p.data_quality_score,
  p.days_of_supply,
  p.last_true_issue_at,
  p.inactive_days,
  p.slow_moving_status,

  p.approved_min_stock,
  p.approved_reorder_point,
  p.approved_target_stock,
  p.approved_max_stock,
  p.reference_stock,
  p.reference_basis,
  p.suggested_target_stock,
  p.recommended_order_quantity,

  p.expiry_quantity_at_risk,
  p.expiry_value_at_risk,
  p.highest_expiry_risk,

  p.availability_state,
  array_remove(array[
    case when coalesce(p.usable_quantity, 0) <= 0 then 'USABLE_QUANTITY_ZERO' end,
    case when p.stock_status = 'CRITICAL' then 'LEGACY_CRITICAL_THRESHOLD' end,
    case when p.stock_status in ('REORDER', 'DEFAULT_LOW_STOCK', 'LOW_STOCK') then 'LEGACY_REORDER_THRESHOLD' end,
    case when p.stock_status = 'OVERSTOCK' then 'LEGACY_OVERSTOCK_THRESHOLD' end,
    case when p.availability_state = 'INSUFFICIENT_REFERENCE' then 'MISSING_POLICY_REFERENCE' end
  ]::text[], null) as availability_reason_codes,

  p.expiry_state,
  array_remove(array[
    case when p.expiry_state <> 'NONE' then 'DIRECT_EXPIRY_DATE_WINDOW' end,
    case when p.expiry_evidence_mode = 'TIME_WINDOW_ONLY' then 'TIME_WINDOW_ONLY' end
  ]::text[], null) as expiry_reason_codes,
  p.expiry_evidence_mode,

  p.evidence_state,
  array_remove(array[
    case when p.forecast_daily_demand is null then 'NO_FINALIZED_DEMAND_FORECAST' end,
    case when p.last_true_issue_at is null then 'NO_TRUE_ISSUE_HISTORY' end,
    case when p.expiry_evidence_mode = 'TIME_WINDOW_ONLY' then 'TIME_WINDOW_ONLY' end,
    case when p.availability_state = 'INSUFFICIENT_REFERENCE' then 'MISSING_POLICY_REFERENCE' end,
    case when coalesce(p.unpriced_lot_count, 0) > 0 then 'MISSING_UNIT_COST' end
  ]::text[], null) as evidence_qualifiers,

  p.recommendation_state,
  array_remove(array[
    case when p.recommendation_state = 'TRANSFER_REVIEW' then 'STOCK_AVAILABLE_ELSEWHERE' end,
    case when p.recommendation_state = 'PROCUREMENT_REVIEW' then 'ORGANIZATION_USABLE_ZERO' end,
    case when p.recommendation_state = 'FEFO_REVIEW' then 'DIRECT_EXPIRY_RISK' end
  ]::text[], null) as recommendation_reason_codes,
  (p.recommendation_state <> 'NONE') as recommendation_requires_human_review,

  (p.expiry_state <> 'NONE' and p.expiry_evidence_mode = 'TIME_WINDOW_ONLY') as suppress_expected_wastage_claims,
  case
    when p.expiry_state <> 'NONE' and p.expiry_evidence_mode = 'TIME_WINDOW_ONLY' then null
    else p.expiry_quantity_at_risk
  end as supported_expiry_quantity_at_risk,
  case
    when p.expiry_state <> 'NONE' and p.expiry_evidence_mode = 'TIME_WINDOW_ONLY' then null
    else p.expiry_value_at_risk
  end as supported_expiry_value_at_risk,

  p.stock_status as legacy_v4_stock_status,
  p.risk_score as legacy_v4_risk_score,
  p.risk_components as legacy_v4_risk_components,
  p.recommendation_basis as legacy_v4_recommendation_basis,
  p.calculated_at,
  'V4_011_MULTI_AXIS'::text as model_version
from projected p;

comment on view public.inventory_intelligence_multi_axis_v4_011 is
  'V4_011 additive multi-axis read model. Security invoker; underlying inventory_intelligence_v4 scoped RLS remains authoritative. Human-review recommendations only.';

revoke all on public.inventory_intelligence_multi_axis_v4_011 from anon;
grant select on public.inventory_intelligence_multi_axis_v4_011 to authenticated;
grant select on public.inventory_intelligence_multi_axis_v4_011 to service_role;
