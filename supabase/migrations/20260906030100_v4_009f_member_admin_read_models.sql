-- V4_009F read models for the read-only Shadow gateway.
-- REVIEW ONLY: intentionally NOT applied to production yet.

create or replace view public.member_admin_v4
with (security_invoker = true)
as
select
  om.id as membership_id,
  om.organization_id,
  om.user_id,
  om.display_name,
  om.email,
  om.status::text as member_status,
  om.role::text as legacy_role,
  om.department_id,
  d.name as department_name,
  om.invited_at,
  om.activated_at,
  om.joined_at,
  om.ended_at,
  om.status_changed_at,
  om.status_reason,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'assignment_id', mr.id,
      'role_code', r.code,
      'role_name', r.name,
      'scope_type', mr.scope_type,
      'scope_id', mr.scope_id,
      'valid_from', mr.valid_from,
      'valid_to', mr.valid_to
    ) order by r.code, mr.valid_from)
    from public.membership_roles mr
    join public.roles r on r.id = mr.role_id
    where mr.membership_id = om.id
      and mr.valid_from <= now()
      and (mr.valid_to is null or mr.valid_to > now())
  ), '[]'::jsonb) as current_roles
from public.organization_members om
left join public.departments d on d.id = om.department_id
where private.has_scoped_permission_v4(om.organization_id, 'membership.manage', null, null);

grant select on public.member_admin_v4 to authenticated, service_role;

create or replace view public.member_lifecycle_history_v4
with (security_invoker = true)
as
select
  a.id as audit_id,
  a.organization_id,
  a.action,
  nullif(a.entity_id, '')::uuid as membership_id,
  a.actor_user_id,
  a.actor_membership_id,
  a.reason,
  a.old_value,
  a.new_value,
  a.created_at
from public.audit_logs a
where a.entity_type = 'ORGANIZATION_MEMBER'
  and a.source_type = 'MEMBER_LIFECYCLE_V4'
  and (
    private.has_scoped_permission_v4(a.organization_id, 'membership.manage', null, null)
    or private.has_scoped_permission_v4(a.organization_id, 'audit.view', null, null)
  );

grant select on public.member_lifecycle_history_v4 to authenticated, service_role;

create or replace view public.member_role_scope_catalog_v4
with (security_invoker = true)
as
select
  o.id as organization_id,
  r.id as role_id,
  r.code as role_code,
  r.name as role_name,
  r.system_role,
  r.default_scope,
  rs.scope_type
from public.organizations o
join public.roles r on r.active = true and (r.organization_id is null or r.organization_id = o.id)
join public.role_scope_rules_v4 rs on rs.role_id = r.id and rs.enabled = true
where private.has_scoped_permission_v4(o.id, 'membership.manage', null, null);

grant select on public.member_role_scope_catalog_v4 to authenticated, service_role;

create or replace view public.member_scope_targets_v4
with (security_invoker = true)
as
select
  d.organization_id,
  'ORG_UNIT'::text as scope_type,
  d.id as scope_id,
  d.code as scope_code,
  d.name as scope_name,
  d.parent_id,
  d.sort_order
from public.departments d
where d.active = true
  and private.has_scoped_permission_v4(d.organization_id, 'membership.manage', null, null)
union all
select
  w.organization_id,
  'WAREHOUSE'::text as scope_type,
  w.id as scope_id,
  w.code as scope_code,
  w.name as scope_name,
  w.org_unit_id as parent_id,
  100000 as sort_order
from public.warehouses w
where w.active = true
  and private.has_scoped_permission_v4(w.organization_id, 'membership.manage', null, null);

grant select on public.member_scope_targets_v4 to authenticated, service_role;
