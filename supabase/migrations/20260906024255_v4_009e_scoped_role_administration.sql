-- Applied to production Supabase as migration v4_009e_scoped_role_administration.
-- Source-controlled copy for reproducibility.

create table if not exists public.role_scope_rules_v4 (
  role_id uuid not null references public.roles(id) on delete cascade,
  scope_type text not null check (scope_type in ('ORGANIZATION','ORG_UNIT','WAREHOUSE')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (role_id, scope_type)
);

alter table public.role_scope_rules_v4 enable row level security;

drop policy if exists role_scope_rules_v4_select on public.role_scope_rules_v4;
create policy role_scope_rules_v4_select
on public.role_scope_rules_v4
for select to authenticated
using ((select auth.uid()) is not null);

grant select on public.role_scope_rules_v4 to authenticated, service_role;
revoke insert, update, delete on public.role_scope_rules_v4 from authenticated;

insert into public.role_scope_rules_v4(role_id, scope_type, enabled)
select r.id, x.scope_type, true
from public.roles r
cross join lateral (
  select unnest(
    case r.code
      when 'OWNER' then array['ORGANIZATION']::text[]
      when 'HOSPITAL_ADMIN' then array['ORGANIZATION']::text[]
      when 'PHARMACY_MANAGER' then array['ORGANIZATION','ORG_UNIT']::text[]
      when 'PHARMACIST' then array['ORGANIZATION','ORG_UNIT','WAREHOUSE']::text[]
      when 'WAREHOUSE_STAFF' then array['WAREHOUSE']::text[]
      when 'IT' then array['ORGANIZATION']::text[]
      when 'AUDITOR' then array['ORGANIZATION','ORG_UNIT','WAREHOUSE']::text[]
      when 'VIEWER' then array['ORGANIZATION','ORG_UNIT','WAREHOUSE']::text[]
      else array[r.default_scope]::text[]
    end
  ) as scope_type
) x
where r.active = true
on conflict (role_id, scope_type) do update set enabled = excluded.enabled;

create or replace function private.seed_role_default_scope_rule_v4()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active then
    insert into public.role_scope_rules_v4(role_id, scope_type, enabled)
    values (new.id, new.default_scope, true)
    on conflict (role_id, scope_type) do update set enabled = true;
  end if;
  return new;
end;
$$;
revoke all on function private.seed_role_default_scope_rule_v4() from public;

drop trigger if exists trg_seed_role_default_scope_rule_v4 on public.roles;
create trigger trg_seed_role_default_scope_rule_v4
after insert or update of default_scope, active on public.roles
for each row execute function private.seed_role_default_scope_rule_v4();

drop index if exists public.membership_roles_assignment_uidx;
create unique index if not exists membership_roles_open_assignment_uidx
on public.membership_roles(
  membership_id,
  role_id,
  scope_type,
  coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)
)
where valid_to is null;

create or replace function private.actor_is_current_owner_v4(p_organization_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members om
    join public.membership_roles mr on mr.membership_id = om.id
    join public.roles r on r.id = mr.role_id
    where om.organization_id = p_organization_id
      and om.user_id = (select auth.uid())
      and om.status = 'ACTIVE'
      and r.code = 'OWNER'
      and mr.scope_type = 'ORGANIZATION'
      and mr.scope_id is null
      and mr.valid_from <= now()
      and (mr.valid_to is null or mr.valid_to > now())
  );
$$;
revoke all on function private.actor_is_current_owner_v4(uuid) from public;
grant execute on function private.actor_is_current_owner_v4(uuid) to authenticated, service_role;

create or replace function private.guard_membership_role_assignment_v4()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_membership_id uuid;
  v_org uuid;
  v_role_id uuid;
  v_role_code text;
  v_scope_type text;
  v_scope_id uuid;
  v_other_open_owner_count bigint;
begin
  if tg_op = 'DELETE' then
    raise exception 'ROLE_ASSIGNMENT_HISTORY_IMMUTABLE';
  end if;

  if tg_op = 'UPDATE' then
    if new.membership_id is distinct from old.membership_id
       or new.role_id is distinct from old.role_id
       or new.scope_type is distinct from old.scope_type
       or new.scope_id is distinct from old.scope_id
       or new.valid_from is distinct from old.valid_from
       or new.assigned_by is distinct from old.assigned_by
       or new.created_at is distinct from old.created_at then
      raise exception 'ROLE_ASSIGNMENT_IDENTITY_IMMUTABLE';
    end if;
  end if;

  v_membership_id := coalesce(new.membership_id, old.membership_id);
  v_role_id := coalesce(new.role_id, old.role_id);
  v_scope_type := coalesce(new.scope_type, old.scope_type);
  v_scope_id := coalesce(new.scope_id, old.scope_id);

  select om.organization_id into v_org
  from public.organization_members om
  where om.id = v_membership_id;
  if v_org is null then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;

  perform 1 from public.organizations o where o.id = v_org for update;

  select r.code into v_role_code
  from public.roles r
  where r.id = v_role_id and r.active = true;
  if v_role_code is null then raise exception 'ROLE_NOT_FOUND_OR_INACTIVE'; end if;

  if not exists (
    select 1 from public.role_scope_rules_v4 rs
    where rs.role_id = v_role_id and rs.scope_type = v_scope_type and rs.enabled = true
  ) then
    raise exception 'ROLE_SCOPE_NOT_ALLOWED';
  end if;

  if tg_op = 'INSERT' and exists (
    select 1 from public.membership_roles mr
    where mr.membership_id = new.membership_id
      and mr.role_id = new.role_id
      and mr.scope_type = new.scope_type
      and mr.scope_id is not distinct from new.scope_id
      and mr.valid_from < coalesce(new.valid_to, 'infinity'::timestamptz)
      and coalesce(mr.valid_to, 'infinity'::timestamptz) > new.valid_from
  ) then
    raise exception 'ROLE_ASSIGNMENT_OVERLAP';
  end if;

  if (select auth.uid()) is not null then
    if not private.has_scoped_permission_v4(v_org, 'membership.manage', null, null) then
      raise exception 'MEMBERSHIP_MANAGE_PERMISSION_REQUIRED';
    end if;
    if v_role_code = 'OWNER' and not private.actor_is_current_owner_v4(v_org) then
      raise exception 'OWNER_ROLE_REQUIRES_OWNER';
    end if;
    if tg_op = 'INSERT' then new.assigned_by := (select auth.uid()); end if;
  end if;

  if v_role_code = 'OWNER' then
    if v_scope_type <> 'ORGANIZATION' or v_scope_id is not null then
      raise exception 'OWNER_SCOPE_MUST_BE_ORGANIZATION';
    end if;
    if tg_op = 'INSERT' and new.valid_to is not null then
      raise exception 'OWNER_ASSIGNMENT_MUST_BE_OPEN_ENDED';
    end if;
    if tg_op = 'UPDATE' and old.valid_to is null and new.valid_to is not null then
      select count(*) into v_other_open_owner_count
      from public.membership_roles mr
      join public.organization_members om on om.id = mr.membership_id
      join public.roles r on r.id = mr.role_id
      where om.organization_id = v_org
        and om.status = 'ACTIVE'
        and r.code = 'OWNER'
        and mr.scope_type = 'ORGANIZATION'
        and mr.scope_id is null
        and mr.id <> old.id
        and mr.valid_from <= now()
        and mr.valid_to is null;
      if v_other_open_owner_count = 0 then raise exception 'LAST_OWNER_CANNOT_BE_ENDED'; end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_membership_role_assignment_v4() from public;

drop trigger if exists trg_guard_membership_role_assignment_v4 on public.membership_roles;
create trigger trg_guard_membership_role_assignment_v4
before insert or update or delete on public.membership_roles
for each row execute function private.guard_membership_role_assignment_v4();

create or replace function private.audit_membership_role_assignment_v4()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_actor_membership uuid;
  v_role_code text;
  v_reason text;
  v_action text;
begin
  select om.organization_id into v_org from public.organization_members om where om.id = new.membership_id;
  select r.code into v_role_code from public.roles r where r.id = new.role_id;
  select om.id into v_actor_membership
  from public.organization_members om
  where om.organization_id = v_org and om.user_id = (select auth.uid()) limit 1;
  v_reason := nullif(current_setting('meicare.audit_reason', true), '');
  v_action := case
    when tg_op = 'INSERT' then 'ROLE_ASSIGNMENT_CREATED'
    when old.valid_to is distinct from new.valid_to and new.valid_to is not null then 'ROLE_ASSIGNMENT_ENDED'
    else 'ROLE_ASSIGNMENT_UPDATED'
  end;
  insert into public.audit_logs(
    organization_id, actor_user_id, actor_membership_id, action, entity_type, entity_id,
    old_value, new_value, source_type, reason, metadata
  ) values (
    v_org, (select auth.uid()), v_actor_membership, v_action, 'MEMBERSHIP_ROLE_ASSIGNMENT', new.id::text,
    case when tg_op='UPDATE' then jsonb_build_object('valid_to',old.valid_to,'role_id',old.role_id,'scope_type',old.scope_type,'scope_id',old.scope_id) else null end,
    jsonb_build_object('valid_from',new.valid_from,'valid_to',new.valid_to,'role_id',new.role_id,'scope_type',new.scope_type,'scope_id',new.scope_id),
    'ROLE_ADMIN_V4', v_reason, jsonb_build_object('role_code',v_role_code)
  );
  return new;
end;
$$;
revoke all on function private.audit_membership_role_assignment_v4() from public;

drop trigger if exists trg_audit_membership_role_assignment_v4 on public.membership_roles;
create trigger trg_audit_membership_role_assignment_v4
after insert or update on public.membership_roles
for each row execute function private.audit_membership_role_assignment_v4();

create or replace function private.assign_membership_role_v4_impl(
  p_organization_id uuid,
  p_membership_id uuid,
  p_role_code text,
  p_scope_type text default null,
  p_scope_id uuid default null,
  p_valid_from timestamptz default null,
  p_valid_to timestamptz default null,
  p_reason text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_role_id uuid;
  v_default_scope text;
  v_scope_type text;
  v_valid_from timestamptz;
  v_assignment_id uuid;
  v_target_status text;
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not private.has_scoped_permission_v4(p_organization_id,'membership.manage',null,null) then
    raise exception 'MEMBERSHIP_MANAGE_PERMISSION_REQUIRED';
  end if;
  perform 1 from public.organizations o where o.id=p_organization_id for update;
  if not found then raise exception 'ORGANIZATION_NOT_FOUND'; end if;

  select om.status::text into v_target_status
  from public.organization_members om
  where om.id=p_membership_id and om.organization_id=p_organization_id;
  if v_target_status is null then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;
  if v_target_status not in ('INVITED','ACTIVE') then raise exception 'MEMBERSHIP_NOT_ASSIGNABLE'; end if;

  select r.id,r.default_scope into v_role_id,v_default_scope
  from public.roles r
  where r.active=true
    and upper(r.code)=upper(trim(p_role_code))
    and (r.organization_id=p_organization_id or r.organization_id is null)
  order by (r.organization_id is not null) desc limit 1;
  if v_role_id is null then raise exception 'ROLE_NOT_FOUND_OR_INACTIVE'; end if;

  v_scope_type := upper(coalesce(nullif(trim(p_scope_type),''),v_default_scope));
  v_valid_from := coalesce(p_valid_from,now());
  if p_valid_to is not null and p_valid_to <= v_valid_from then raise exception 'INVALID_ROLE_VALIDITY_WINDOW'; end if;
  if not exists (select 1 from public.role_scope_rules_v4 rs where rs.role_id=v_role_id and rs.scope_type=v_scope_type and rs.enabled=true) then
    raise exception 'ROLE_SCOPE_NOT_ALLOWED';
  end if;
  if exists (
    select 1 from public.membership_roles mr
    where mr.membership_id=p_membership_id and mr.role_id=v_role_id
      and mr.scope_type=v_scope_type and mr.scope_id is not distinct from p_scope_id
      and mr.valid_from < coalesce(p_valid_to,'infinity'::timestamptz)
      and coalesce(mr.valid_to,'infinity'::timestamptz) > v_valid_from
  ) then raise exception 'ROLE_ASSIGNMENT_OVERLAP'; end if;

  perform set_config('meicare.audit_reason',left(coalesce(p_reason,''),1000),true);
  insert into public.membership_roles(membership_id,role_id,scope_type,scope_id,assigned_by,valid_from,valid_to)
  values(p_membership_id,v_role_id,v_scope_type,p_scope_id,(select auth.uid()),v_valid_from,p_valid_to)
  returning id into v_assignment_id;
  return v_assignment_id;
end;
$$;
revoke all on function private.assign_membership_role_v4_impl(uuid,uuid,text,text,uuid,timestamptz,timestamptz,text) from public;
grant execute on function private.assign_membership_role_v4_impl(uuid,uuid,text,text,uuid,timestamptz,timestamptz,text) to authenticated,service_role;

create or replace function public.assign_membership_role_v4(
  p_organization_id uuid,
  p_membership_id uuid,
  p_role_code text,
  p_scope_type text default null,
  p_scope_id uuid default null,
  p_valid_from timestamptz default null,
  p_valid_to timestamptz default null,
  p_reason text default null
)
returns uuid language sql security invoker set search_path='' as $$
  select private.assign_membership_role_v4_impl(p_organization_id,p_membership_id,p_role_code,p_scope_type,p_scope_id,p_valid_from,p_valid_to,p_reason);
$$;
revoke all on function public.assign_membership_role_v4(uuid,uuid,text,text,uuid,timestamptz,timestamptz,text) from public;
grant execute on function public.assign_membership_role_v4(uuid,uuid,text,text,uuid,timestamptz,timestamptz,text) to authenticated,service_role;

create or replace function private.end_membership_role_v4_impl(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_end_at timestamptz default null,
  p_reason text default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_valid_from timestamptz;
  v_valid_to timestamptz;
  v_end_at timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not private.has_scoped_permission_v4(p_organization_id,'membership.manage',null,null) then
    raise exception 'MEMBERSHIP_MANAGE_PERMISSION_REQUIRED';
  end if;
  perform 1 from public.organizations o where o.id=p_organization_id for update;
  if not found then raise exception 'ORGANIZATION_NOT_FOUND'; end if;
  select mr.valid_from,mr.valid_to into v_valid_from,v_valid_to
  from public.membership_roles mr
  join public.organization_members om on om.id=mr.membership_id
  where mr.id=p_assignment_id and om.organization_id=p_organization_id
  for update of mr;
  if v_valid_from is null then raise exception 'ROLE_ASSIGNMENT_NOT_FOUND'; end if;
  if v_valid_to is not null then raise exception 'ROLE_ASSIGNMENT_ALREADY_ENDED_OR_SCHEDULED'; end if;
  v_end_at := coalesce(p_end_at,now());
  if v_end_at <= v_valid_from then raise exception 'INVALID_ROLE_END_TIME'; end if;
  perform set_config('meicare.audit_reason',left(coalesce(p_reason,''),1000),true);
  update public.membership_roles set valid_to=v_end_at where id=p_assignment_id;
  return p_assignment_id;
end;
$$;
revoke all on function private.end_membership_role_v4_impl(uuid,uuid,timestamptz,text) from public;
grant execute on function private.end_membership_role_v4_impl(uuid,uuid,timestamptz,text) to authenticated,service_role;

create or replace function public.end_membership_role_v4(
  p_organization_id uuid,
  p_assignment_id uuid,
  p_end_at timestamptz default null,
  p_reason text default null
)
returns uuid language sql security invoker set search_path='' as $$
  select private.end_membership_role_v4_impl(p_organization_id,p_assignment_id,p_end_at,p_reason);
$$;
revoke all on function public.end_membership_role_v4(uuid,uuid,timestamptz,text) from public;
grant execute on function public.end_membership_role_v4(uuid,uuid,timestamptz,text) to authenticated,service_role;

create or replace function private.list_membership_role_assignments_v4_impl(p_organization_id uuid)
returns table(
  assignment_id uuid,membership_id uuid,user_id uuid,display_name text,email text,member_status text,legacy_role text,
  role_id uuid,role_code text,role_name text,scope_type text,scope_id uuid,scope_code text,scope_name text,
  valid_from timestamptz,valid_to timestamptz,is_current boolean,assigned_by uuid,created_at timestamptz
)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not (private.has_scoped_permission_v4(p_organization_id,'membership.view',null,null)
          or private.has_scoped_permission_v4(p_organization_id,'membership.manage',null,null)) then
    raise exception 'MEMBERSHIP_VIEW_PERMISSION_REQUIRED';
  end if;
  return query
  select mr.id,om.id,om.user_id,om.display_name,om.email,om.status::text,om.role::text,r.id,r.code,r.name,mr.scope_type,mr.scope_id,
    case when mr.scope_type='ORG_UNIT' then d.code when mr.scope_type='WAREHOUSE' then w.code else null end,
    case when mr.scope_type='ORG_UNIT' then d.name when mr.scope_type='WAREHOUSE' then w.name else 'Toàn tổ chức' end,
    mr.valid_from,mr.valid_to,(om.status='ACTIVE' and mr.valid_from<=now() and (mr.valid_to is null or mr.valid_to>now())),mr.assigned_by,mr.created_at
  from public.membership_roles mr
  join public.organization_members om on om.id=mr.membership_id
  join public.roles r on r.id=mr.role_id
  left join public.departments d on mr.scope_type='ORG_UNIT' and d.id=mr.scope_id
  left join public.warehouses w on mr.scope_type='WAREHOUSE' and w.id=mr.scope_id
  where om.organization_id=p_organization_id
  order by om.display_name nulls last,om.email nulls last,r.code,mr.valid_from desc;
end;
$$;
revoke all on function private.list_membership_role_assignments_v4_impl(uuid) from public;
grant execute on function private.list_membership_role_assignments_v4_impl(uuid) to authenticated,service_role;

create or replace function public.list_membership_role_assignments_v4(p_organization_id uuid)
returns table(
  assignment_id uuid,membership_id uuid,user_id uuid,display_name text,email text,member_status text,legacy_role text,
  role_id uuid,role_code text,role_name text,scope_type text,scope_id uuid,scope_code text,scope_name text,
  valid_from timestamptz,valid_to timestamptz,is_current boolean,assigned_by uuid,created_at timestamptz
)
language sql security invoker set search_path='' as $$
  select * from private.list_membership_role_assignments_v4_impl(p_organization_id);
$$;
revoke all on function public.list_membership_role_assignments_v4(uuid) from public;
grant execute on function public.list_membership_role_assignments_v4(uuid) to authenticated,service_role;

create or replace function private.list_role_scope_catalog_v4_impl(p_organization_id uuid)
returns table(role_id uuid,role_code text,role_name text,system_role boolean,default_scope text,scope_type text)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not (private.has_scoped_permission_v4(p_organization_id,'membership.view',null,null)
          or private.has_scoped_permission_v4(p_organization_id,'membership.manage',null,null)) then
    raise exception 'MEMBERSHIP_VIEW_PERMISSION_REQUIRED';
  end if;
  return query
  select r.id,r.code,r.name,r.system_role,r.default_scope,rs.scope_type
  from public.roles r
  join public.role_scope_rules_v4 rs on rs.role_id=r.id and rs.enabled=true
  where r.active=true and (r.organization_id is null or r.organization_id=p_organization_id)
  order by r.code,rs.scope_type;
end;
$$;
revoke all on function private.list_role_scope_catalog_v4_impl(uuid) from public;
grant execute on function private.list_role_scope_catalog_v4_impl(uuid) to authenticated,service_role;

create or replace function public.list_role_scope_catalog_v4(p_organization_id uuid)
returns table(role_id uuid,role_code text,role_name text,system_role boolean,default_scope text,scope_type text)
language sql security invoker set search_path='' as $$
  select * from private.list_role_scope_catalog_v4_impl(p_organization_id);
$$;
revoke all on function public.list_role_scope_catalog_v4(uuid) from public;
grant execute on function public.list_role_scope_catalog_v4(uuid) to authenticated,service_role;

revoke insert,update,delete on public.membership_roles from authenticated;
grant select on public.membership_roles to authenticated;
