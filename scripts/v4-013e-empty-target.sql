-- Read-only preflight. Only an unused, isolated Supabase target is eligible.
begin;
set transaction read only;
set local statement_timeout = '10s';
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'integration', 'private', 'supabase_migrations')
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and not exists (
        select 1 from pg_depend d where d.classid = 'pg_class'::regclass
          and d.objid = c.oid and d.deptype = 'e'
      )
  ) or exists (select 1 from auth.users)
    or exists (select 1 from storage.objects) then
    raise exception 'V4_013E_TARGET_NOT_EMPTY';
  end if;
end $$;
select 'V4_013E_EMPTY_TARGET_PASS' as result;
rollback;
