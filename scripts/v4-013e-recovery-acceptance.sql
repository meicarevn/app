-- V4_013E invariant checks for an isolated restore target only.
-- This script is read-only and intentionally does not set readiness evidence.

begin;
set transaction read only;
set local statement_timeout = '60s';
set local timezone = 'UTC';

do $$
declare
  v_missing text[];
  v_count bigint;
begin
  select array_agg(required.object_name order by required.object_name)
  into v_missing
  from (values
    ('public.organizations'),
    ('public.warehouses'),
    ('public.drugs'),
    ('public.drug_lots'),
    ('public.inventory_snapshots'),
    ('public.inventory_snapshot_lines'),
    ('public.inventory_events'),
    ('public.audit_logs'),
    ('integration.import_jobs'),
    ('public.organization_runtime_v4')
  ) required(object_name)
  where to_regclass(required.object_name) is null;

  if v_missing is not null then
    raise exception 'V4_013E_REQUIRED_OBJECTS_MISSING: %', v_missing;
  end if;

  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and n.nspname in ('public', 'integration')
    and not c.relrowsecurity;
  if v_count <> 0 then
    raise exception 'V4_013E_API_TABLE_WITHOUT_RLS: %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_events
  where ledger_sequence is null;
  if v_count <> 0 then
    raise exception 'V4_013E_NULL_LEDGER_SEQUENCE: %', v_count;
  end if;

  select count(*) into v_count
  from (
    select organization_id, ledger_sequence
    from public.inventory_events
    group by organization_id, ledger_sequence
    having count(*) > 1
  ) duplicates;
  if v_count <> 0 then
    raise exception 'V4_013E_DUPLICATE_LEDGER_SEQUENCE: %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_events e
  left join public.warehouses w on w.id = e.warehouse_id
  left join public.drugs d on d.id = e.drug_id
  left join public.drug_lots l on l.id = e.drug_lot_id
  where (e.warehouse_id is not null and w.id is null)
     or (e.drug_id is not null and d.id is null)
     or (e.drug_lot_id is not null and l.id is null);
  if v_count <> 0 then
    raise exception 'V4_013E_ORPHAN_INVENTORY_EVENT: %', v_count;
  end if;

  select count(*) into v_count
  from public.inventory_snapshot_lines l
  left join public.inventory_snapshots s on s.id = l.snapshot_id
  where s.id is null;
  if v_count <> 0 then
    raise exception 'V4_013E_ORPHAN_SNAPSHOT_LINE: %', v_count;
  end if;
end
$$;

select 'V4_013E_RESTORE_INVARIANTS_PASS' as result;

rollback;
