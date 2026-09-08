-- Metadata only. No application rows, secret values, job commands or credentials.
begin;
set transaction read only;
set local statement_timeout = '15s';
with managed_columns as (
  select n.nspname as schema_name, c.relname as table_name,
    a.attname as column_name, format_type(a.atttypid, a.atttypmod) as data_type,
    a.attnotnull as not_null
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('auth', 'storage') and c.relkind in ('r', 'p')
    and a.attnum > 0 and not a.attisdropped
)
select jsonb_build_object(
  'format_version', 1,
  'postgres_major', current_setting('server_version_num')::integer / 10000,
  'extensions', (select jsonb_agg(jsonb_build_object(
    'name', e.extname, 'version', e.extversion, 'schema', n.nspname)
    order by e.extname) from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace),
  'managed_columns', (select jsonb_agg(jsonb_build_object(
    'schema', schema_name, 'table', table_name, 'column', column_name,
    'type', data_type, 'not_null', not_null)
    order by schema_name, table_name, column_name) from managed_columns)
) as compatibility_manifest;
rollback;
