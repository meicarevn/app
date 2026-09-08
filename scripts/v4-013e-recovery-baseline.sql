-- V4_013E deterministic, read-only recovery manifest.
-- Run against both the source database immediately before a backup and the
-- isolated restore target. The two CSV outputs must match byte-for-byte.

begin;
set transaction read only;
set local statement_timeout = '60s';
set local timezone = 'UTC';

with manifest(section, metric, value) as (
  values
    ('identity', 'postgres_major', (current_setting('server_version_num')::integer / 10000)::text)
), complete_manifest as (
  select section, metric, value from manifest
  union all select 'migration', 'applied_count', count(*)::text from supabase_migrations.schema_migrations
  union all select 'migration', 'latest_version', coalesce(max(version), '') from supabase_migrations.schema_migrations

  union all select 'row_count', 'public.organizations', count(*)::text from public.organizations
  union all select 'row_count', 'public.organization_members', count(*)::text from public.organization_members
  union all select 'row_count', 'public.warehouses', count(*)::text from public.warehouses
  union all select 'row_count', 'public.drugs', count(*)::text from public.drugs
  union all select 'row_count', 'public.drug_lots', count(*)::text from public.drug_lots
  union all select 'row_count', 'public.inventory_snapshots', count(*)::text from public.inventory_snapshots
  union all select 'row_count', 'public.inventory_snapshot_lines', count(*)::text from public.inventory_snapshot_lines
  union all select 'row_count', 'public.inventory_events', count(*)::text from public.inventory_events
  union all select 'row_count', 'public.inventory_daily_facts', count(*)::text from public.inventory_daily_facts
  union all select 'row_count', 'public.inventory_position_current_v3', count(*)::text from public.inventory_position_current_v3
  union all select 'row_count', 'public.inventory_reference_levels', count(*)::text from public.inventory_reference_levels
  union all select 'row_count', 'public.alerts', count(*)::text from public.alerts
  union all select 'row_count', 'public.actions', count(*)::text from public.actions
  union all select 'row_count', 'public.audit_logs', count(*)::text from public.audit_logs
  union all select 'row_count', 'integration.import_jobs', count(*)::text from integration.import_jobs
  union all select 'row_count', 'public.organization_runtime_v4', count(*)::text from public.organization_runtime_v4

  union all
  select 'digest', 'public.inventory_events', md5(coalesce(string_agg(
    concat_ws('|', id, organization_id, source_system, source_event_id,
      source_sequence, event_type, event_status, occurred_at, warehouse_id,
      storage_zone_id, drug_id, drug_lot_id, quantity_delta,
      correction_of_event_id, ledger_sequence, unit_cost, transaction_id,
      sync_run_id, import_job_id, posted_at), E'\n' order by id), ''))
  from public.inventory_events

  union all
  select 'digest', 'public.inventory_snapshot_lines', md5(coalesce(string_agg(
    concat_ws('|', id, organization_id, snapshot_id, warehouse_id,
      storage_zone_id, drug_id, drug_lot_id, quantity_on_hand,
      quantity_reserved, unit_cost, last_issue_at, source_row_number),
    E'\n' order by id), ''))
  from public.inventory_snapshot_lines

  union all
  select 'digest', 'public.drug_lots', md5(coalesce(string_agg(
    concat_ws('|', id, organization_id, drug_id, lot_number, manufacture_date,
      expiry_date, unit_cost, active, tender_number, identity_status,
      expiry_verified_at, expiry_verified_by, expiry_verification_source),
    E'\n' order by id), ''))
  from public.drug_lots

  union all
  select 'digest', 'public.organization_runtime_v4', md5(coalesce(string_agg(
    concat_ws('|', organization_id, cutover_stage, inventory_write_mode,
      alert_publish_mode, his_ingestion_mode, integration_layer_ready,
      frontend_v4_ready, r2_gateway_ready, iot_gateway_ready,
      ai_orchestrator_ready, backup_restore_verified_at,
      backup_restore_evidence, last_gate_run_id, last_gate_passed,
      last_gate_at, rollback_reason), E'\n' order by organization_id), ''))
  from public.organization_runtime_v4

  union all
  select 'schema', 'functions', md5(coalesce(string_agg(
    n.nspname || '.' || p.oid::regprocedure::text || E'\n' ||
      pg_get_functiondef(p.oid), E'\n---\n' order by n.nspname, p.oid::regprocedure::text), ''))
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'integration', 'private')

  union all
  select 'schema', 'rls_policies', md5(coalesce(string_agg(
    concat_ws('|', schemaname, tablename, policyname, permissive, roles,
      cmd, qual, with_check), E'\n'
      order by schemaname, tablename, policyname), ''))
  from pg_policies
  where schemaname in ('public', 'integration', 'private')

  union all
  select 'integrity', 'null_ledger_sequence', count(*)::text
  from public.inventory_events where ledger_sequence is null

  union all
  select 'integrity', 'duplicate_ledger_sequence', count(*)::text
  from (
    select organization_id, ledger_sequence
    from public.inventory_events
    group by organization_id, ledger_sequence
    having count(*) > 1
  ) duplicates

  union all
  select 'integrity', 'orphan_event_warehouse', count(*)::text
  from public.inventory_events e
  left join public.warehouses w on w.id = e.warehouse_id
  where e.warehouse_id is not null and w.id is null

  union all
  select 'integrity', 'orphan_event_drug', count(*)::text
  from public.inventory_events e
  left join public.drugs d on d.id = e.drug_id
  where e.drug_id is not null and d.id is null

  union all
  select 'integrity', 'orphan_event_lot', count(*)::text
  from public.inventory_events e
  left join public.drug_lots l on l.id = e.drug_lot_id
  where e.drug_lot_id is not null and l.id is null

  union all
  select 'integrity', 'orphan_snapshot_line', count(*)::text
  from public.inventory_snapshot_lines l
  left join public.inventory_snapshots s on s.id = l.snapshot_id
  where s.id is null

  union all
  select 'integrity', 'api_tables_without_rls', count(*)::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname in ('public', 'integration')
    and not c.relrowsecurity
)
select section, metric, value
from complete_manifest
order by section, metric;

rollback;
