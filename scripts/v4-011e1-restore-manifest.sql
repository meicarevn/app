with table_stats as (
  select 'public.organizations' as entity, count(*)::bigint as row_count,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), '')) as content_hash
  from public.organizations t
  union all
  select 'public.organization_members', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.organization_members t
  union all
  select 'public.departments', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.departments t
  union all
  select 'public.warehouses', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.warehouses t
  union all
  select 'public.drugs', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.drugs t
  union all
  select 'public.drug_lots', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.drug_lots t
  union all
  select 'public.inventory_events', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.inventory_events t
  union all
  select 'public.inventory_balances', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.inventory_balances t
  union all
  select 'public.inventory_intelligence_v4', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.inventory_intelligence_v4 t
  union all
  select 'public.alerts', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.alerts t
  union all
  select 'public.actions', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from public.actions t
  union all
  select 'integration.import_jobs', count(*)::bigint,
         md5(coalesce(string_agg(md5(row_to_json(t)::text), '' order by md5(row_to_json(t)::text)), ''))
  from integration.import_jobs t
),
meta as (
  select pg_database_size(current_database())::bigint as database_bytes,
         current_setting('server_version') as server_version,
         now() as captured_at,
         (select count(*) from storage.buckets)::bigint as storage_bucket_count,
         (select count(*) from storage.objects)::bigint as storage_object_count,
         (select count(*) from pg_policies where schemaname in ('public','integration'))::bigint as rls_policy_count,
         (select count(*) from supabase_migrations.schema_migrations)::bigint as migration_count,
         (select max(version) from supabase_migrations.schema_migrations) as latest_migration_version
)
select jsonb_build_object(
  'captured_at', meta.captured_at,
  'database_bytes', meta.database_bytes,
  'server_version', meta.server_version,
  'storage_bucket_count', meta.storage_bucket_count,
  'storage_object_count', meta.storage_object_count,
  'rls_policy_count', meta.rls_policy_count,
  'migration_count', meta.migration_count,
  'latest_migration_version', meta.latest_migration_version,
  'entities', (select jsonb_agg(jsonb_build_object('entity', entity, 'row_count', row_count, 'content_hash', content_hash) order by entity) from table_stats),
  'runtime', (
    select jsonb_build_object(
      'organization_id', r.organization_id,
      'cutover_stage', r.cutover_stage,
      'inventory_write_mode', r.inventory_write_mode,
      'alert_publish_mode', r.alert_publish_mode,
      'his_ingestion_mode', r.his_ingestion_mode,
      'frontend_v4_ready', r.frontend_v4_ready,
      'integration_layer_ready', r.integration_layer_ready,
      'r2_gateway_ready', r.r2_gateway_ready,
      'iot_gateway_ready', r.iot_gateway_ready,
      'ai_orchestrator_ready', r.ai_orchestrator_ready,
      'backup_restore_verified_at', r.backup_restore_verified_at
    )
    from public.organization_runtime_v4 r
    where r.organization_id = '68d83220-4e5d-46e7-8bd3-7863205985f4'::uuid
  ),
  'ledger_drift_rows', (select count(*) from public.inventory_ledger_drift_v4 where organization_id = '68d83220-4e5d-46e7-8bd3-7863205985f4'::uuid),
  'projection_rows', (select count(*) from public.inventory_intelligence_v4 where organization_id = '68d83220-4e5d-46e7-8bd3-7863205985f4'::uuid)
) as restore_manifest
from meta;
