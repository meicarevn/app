-- Applied to production Supabase as migration v4_009e_scope_catalog_rls_hardening.

create or replace function private.can_view_org_unit_v4(
  p_organization_id uuid,
  p_org_unit_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members om
    join public.membership_roles mr on mr.membership_id = om.id
    join public.roles r on r.id = mr.role_id and r.active = true
    join public.role_permissions rp on rp.role_id = r.id
    join public.permissions p on p.id = rp.permission_id and p.code = 'org_unit.view'
    where om.organization_id = p_organization_id
      and om.user_id = (select auth.uid())
      and om.status = 'ACTIVE'
      and mr.valid_from <= now()
      and (mr.valid_to is null or mr.valid_to > now())
      and (
        mr.scope_type = 'ORGANIZATION'
        or (
          mr.scope_type = 'ORG_UNIT'
          and mr.scope_id is not null
          and private.org_unit_descends_from_v4(p_organization_id,mr.scope_id,p_org_unit_id)
        )
        or (
          mr.scope_type = 'WAREHOUSE'
          and exists (
            select 1
            from public.warehouses w
            where w.id = mr.scope_id
              and w.organization_id = p_organization_id
              and w.org_unit_id is not null
              and private.org_unit_descends_from_v4(p_organization_id,p_org_unit_id,w.org_unit_id)
          )
        )
      )
  );
$$;
revoke all on function private.can_view_org_unit_v4(uuid,uuid) from public;
grant execute on function private.can_view_org_unit_v4(uuid,uuid) to authenticated,service_role;

drop policy if exists departments_tenant_select on public.departments;
create policy departments_scoped_select_v4
on public.departments for select to authenticated
using (private.can_view_org_unit_v4(organization_id,id));

drop policy if exists departments_insert_admin on public.departments;
create policy departments_insert_scoped_manage_v4
on public.departments for insert to authenticated
with check (private.has_scoped_permission_v4(organization_id,'org_unit.manage',null,coalesce(parent_id,id)));

drop policy if exists departments_update_admin on public.departments;
create policy departments_update_scoped_manage_v4
on public.departments for update to authenticated
using (private.has_scoped_permission_v4(organization_id,'org_unit.manage',null,id))
with check (private.has_scoped_permission_v4(organization_id,'org_unit.manage',null,id));

drop policy if exists departments_delete_admin on public.departments;
create policy departments_delete_scoped_manage_v4
on public.departments for delete to authenticated
using (private.has_scoped_permission_v4(organization_id,'org_unit.manage',null,id));

drop policy if exists warehouses_tenant_select on public.warehouses;
create policy warehouses_scoped_select_v4
on public.warehouses for select to authenticated
using (private.has_scoped_permission_v4(organization_id,'warehouse.view',id,org_unit_id));

drop policy if exists warehouses_manage_insert on public.warehouses;
create policy warehouses_insert_scoped_manage_v4
on public.warehouses for insert to authenticated
with check (private.has_scoped_permission_v4(organization_id,'warehouse.manage',null,org_unit_id));

drop policy if exists warehouses_manage_update on public.warehouses;
create policy warehouses_update_scoped_manage_v4
on public.warehouses for update to authenticated
using (private.has_scoped_permission_v4(organization_id,'warehouse.manage',id,org_unit_id))
with check (private.has_scoped_permission_v4(organization_id,'warehouse.manage',id,org_unit_id));

drop policy if exists warehouses_manage_delete on public.warehouses;
create policy warehouses_delete_scoped_manage_v4
on public.warehouses for delete to authenticated
using (private.has_scoped_permission_v4(organization_id,'warehouse.manage',id,org_unit_id));
