-- V4_009F — Member Lifecycle & Role Administration UI
-- REVIEW ONLY: intentionally NOT applied to production yet.
-- Material auth/authorization change; production apply requires release-gate approval.

alter table public.organization_members
  add column if not exists invited_at timestamptz,
  add column if not exists invited_by uuid references auth.users(id) on delete set null,
  add column if not exists activated_at timestamptz,
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists status_reason text;

create index if not exists organization_members_invited_by_v4_idx
  on public.organization_members(invited_by)
  where invited_by is not null;

-- V4 role assignments become the authorization source for legacy has_org_role callers.
-- organization_members.role remains compatibility/display state only.
create or replace function private.has_org_role(p_org_id uuid, p_roles public.member_role[])
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
    join public.roles r on r.id = mr.role_id
    where om.organization_id = p_org_id
      and om.user_id = (select auth.uid())
      and om.status = 'ACTIVE'
      and mr.scope_type = 'ORGANIZATION'
      and mr.scope_id is null
      and mr.valid_from <= now()
      and (mr.valid_to is null or mr.valid_to > now())
      and r.code in (select x::text from unnest(p_roles) as x)
  );
$$;
revoke all on function private.has_org_role(uuid, public.member_role[]) from public;
grant execute on function private.has_org_role(uuid, public.member_role[]) to authenticated, service_role;

create or replace function private.guard_member_lifecycle_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_current_owner boolean;
  v_reason text;
begin
  if tg_op <> 'UPDATE' or new.status is not distinct from old.status then
    return new;
  end if;

  if not (
    (old.status = 'INVITED' and new.status in ('ACTIVE','DISABLED')) or
    (old.status = 'ACTIVE' and new.status in ('SUSPENDED','DISABLED')) or
    (old.status = 'SUSPENDED' and new.status in ('ACTIVE','DISABLED')) or
    (old.status = 'DISABLED' and new.status = 'ACTIVE')
  ) then
    raise exception 'MEMBER_STATUS_TRANSITION_NOT_ALLOWED';
  end if;

  select exists (
    select 1
    from public.membership_roles mr
    join public.roles r on r.id = mr.role_id
    where mr.membership_id = old.id
      and r.code = 'OWNER'
      and mr.scope_type = 'ORGANIZATION'
      and mr.scope_id is null
      and mr.valid_from <= now()
      and (mr.valid_to is null or mr.valid_to > now())
  ) into v_is_current_owner;

  if v_is_current_owner and new.status <> 'ACTIVE' then
    raise exception 'OWNER_STATUS_PROTECTED';
  end if;

  v_reason := nullif(current_setting('meicare.audit_reason', true), '');
  new.status_changed_at := now();
  new.status_reason := left(v_reason, 1000);

  if new.status = 'ACTIVE' then
    if old.status = 'INVITED' then
      new.activated_at := coalesce(new.activated_at, now());
      new.joined_at := now();
    end if;
    new.ended_at := null;
  elsif new.status = 'DISABLED' then
    new.ended_at := now();
  end if;

  return new;
end;
$$;
revoke all on function private.guard_member_lifecycle_v4() from public;

drop trigger if exists trg_guard_member_lifecycle_v4 on public.organization_members;
create trigger trg_guard_member_lifecycle_v4
before update of status on public.organization_members
for each row execute function private.guard_member_lifecycle_v4();

create or replace function private.audit_member_lifecycle_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_membership uuid;
  v_action text;
  v_reason text;
begin
  if tg_op = 'INSERT' then
    v_action := case when new.status = 'INVITED' then 'MEMBER_INVITED' else 'MEMBER_CREATED' end;
  elsif new.status is not distinct from old.status then
    return new;
  else
    v_action := case new.status::text
      when 'ACTIVE' then case when old.status = 'INVITED' then 'MEMBER_ACTIVATED' else 'MEMBER_REACTIVATED' end
      when 'SUSPENDED' then 'MEMBER_SUSPENDED'
      when 'DISABLED' then 'MEMBER_DISABLED'
      else 'MEMBER_STATUS_CHANGED'
    end;
  end if;

  select om.id into v_actor_membership
  from public.organization_members om
  where om.organization_id = new.organization_id
    and om.user_id = (select auth.uid())
  limit 1;

  v_reason := nullif(current_setting('meicare.audit_reason', true), '');

  insert into public.audit_logs(
    organization_id, actor_user_id, actor_membership_id,
    action, entity_type, entity_id, old_value, new_value,
    source_type, reason, metadata
  ) values (
    new.organization_id,
    (select auth.uid()),
    v_actor_membership,
    v_action,
    'ORGANIZATION_MEMBER',
    new.id::text,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'status', old.status,
      'department_id', old.department_id,
      'legacy_role', old.role
    ) else null end,
    jsonb_build_object(
      'status', new.status,
      'department_id', new.department_id,
      'legacy_role', new.role,
      'invited_at', new.invited_at,
      'activated_at', new.activated_at,
      'ended_at', new.ended_at
    ),
    'MEMBER_LIFECYCLE_V4',
    left(coalesce(v_reason, new.status_reason, ''), 1000),
    jsonb_build_object('user_id', new.user_id, 'email', new.email)
  );

  return new;
end;
$$;
revoke all on function private.audit_member_lifecycle_v4() from public;

drop trigger if exists trg_audit_member_lifecycle_v4 on public.organization_members;
create trigger trg_audit_member_lifecycle_v4
after insert or update of status on public.organization_members
for each row execute function private.audit_member_lifecycle_v4();

create or replace function private.validate_member_invite_v4_impl(
  p_organization_id uuid,
  p_role_code text,
  p_scope_type text,
  p_scope_id uuid,
  p_department_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role_id uuid;
  v_default_scope text;
  v_scope_type text;
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not private.has_scoped_permission_v4(p_organization_id, 'membership.manage', null, null) then
    raise exception 'MEMBERSHIP_MANAGE_PERMISSION_REQUIRED';
  end if;

  select r.id, r.default_scope into v_role_id, v_default_scope
  from public.roles r
  where r.active = true
    and upper(r.code) = upper(trim(p_role_code))
    and (r.organization_id = p_organization_id or r.organization_id is null)
  order by (r.organization_id is not null) desc
  limit 1;

  if v_role_id is null then raise exception 'ROLE_NOT_FOUND_OR_INACTIVE'; end if;
  if upper(trim(p_role_code)) = 'OWNER' then raise exception 'OWNER_INVITE_NOT_ALLOWED'; end if;

  v_scope_type := upper(coalesce(nullif(trim(p_scope_type), ''), v_default_scope));
  if not exists (
    select 1 from public.role_scope_rules_v4 rs
    where rs.role_id = v_role_id and rs.scope_type = v_scope_type and rs.enabled = true
  ) then raise exception 'ROLE_SCOPE_NOT_ALLOWED'; end if;

  if v_scope_type = 'ORGANIZATION' then
    if p_scope_id is not null then raise exception 'ORGANIZATION_SCOPE_ID_MUST_BE_NULL'; end if;
  elsif v_scope_type = 'ORG_UNIT' then
    if p_scope_id is null or not exists (
      select 1 from public.departments d
      where d.id = p_scope_id and d.organization_id = p_organization_id and d.active = true
    ) then raise exception 'ORG_UNIT_SCOPE_OUTSIDE_ORGANIZATION'; end if;
  elsif v_scope_type = 'WAREHOUSE' then
    if p_scope_id is null or not exists (
      select 1 from public.warehouses w
      where w.id = p_scope_id and w.organization_id = p_organization_id and w.active = true
    ) then raise exception 'WAREHOUSE_SCOPE_OUTSIDE_ORGANIZATION'; end if;
  else
    raise exception 'INVALID_SCOPE_TYPE';
  end if;

  if p_department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = p_department_id and d.organization_id = p_organization_id and d.active = true
  ) then raise exception 'DEPARTMENT_OUTSIDE_ORGANIZATION'; end if;

  return jsonb_build_object('valid', true, 'role_id', v_role_id, 'scope_type', v_scope_type);
end;
$$;
revoke all on function private.validate_member_invite_v4_impl(uuid,text,text,uuid,uuid) from public;
grant execute on function private.validate_member_invite_v4_impl(uuid,text,text,uuid,uuid) to authenticated, service_role;

create or replace function public.validate_member_invite_v4(
  p_organization_id uuid,
  p_role_code text,
  p_scope_type text default null,
  p_scope_id uuid default null,
  p_department_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.validate_member_invite_v4_impl(
    p_organization_id, p_role_code, p_scope_type, p_scope_id, p_department_id
  );
$$;
revoke all on function public.validate_member_invite_v4(uuid,text,text,uuid,uuid) from public;
grant execute on function public.validate_member_invite_v4(uuid,text,text,uuid,uuid) to authenticated;

create or replace function private.register_invited_member_v4_impl(
  p_organization_id uuid,
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_role_code text,
  p_scope_type text default null,
  p_scope_id uuid default null,
  p_department_id uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member_id uuid;
  v_assignment_id uuid;
  v_legacy_role public.member_role;
  v_auth_email text;
  v_reason text;
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not private.has_scoped_permission_v4(p_organization_id, 'membership.manage', null, null) then
    raise exception 'MEMBERSHIP_MANAGE_PERMISSION_REQUIRED';
  end if;

  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'AUDIT_REASON_REQUIRED'; end if;
  if nullif(trim(coalesce(p_display_name, '')), '') is null then raise exception 'DISPLAY_NAME_REQUIRED'; end if;
  if upper(trim(p_role_code)) = 'OWNER' then raise exception 'OWNER_INVITE_NOT_ALLOWED'; end if;

  perform private.validate_member_invite_v4_impl(
    p_organization_id, p_role_code, p_scope_type, p_scope_id, p_department_id
  );

  select lower(u.email) into v_auth_email
  from auth.users u
  where u.id = p_user_id;
  if v_auth_email is null then raise exception 'AUTH_USER_NOT_FOUND'; end if;
  if v_auth_email <> lower(trim(p_email)) then raise exception 'AUTH_USER_EMAIL_MISMATCH'; end if;

  if exists (
    select 1 from public.organization_members om
    where om.organization_id = p_organization_id and om.user_id = p_user_id
  ) then raise exception 'MEMBERSHIP_ALREADY_EXISTS'; end if;

  begin
    v_legacy_role := upper(trim(p_role_code))::public.member_role;
  exception when invalid_text_representation then
    v_legacy_role := 'VIEWER'::public.member_role;
  end;

  perform set_config('meicare.audit_reason', left(v_reason, 1000), true);

  insert into public.organization_members(
    organization_id, user_id, role, status, department_id,
    display_name, email, invited_at, invited_by,
    status_changed_at, status_reason
  ) values (
    p_organization_id, p_user_id, v_legacy_role, 'INVITED', p_department_id,
    left(trim(p_display_name), 160), lower(trim(p_email)), now(), (select auth.uid()),
    now(), left(v_reason, 1000)
  ) returning id into v_member_id;

  v_assignment_id := private.assign_membership_role_v4_impl(
    p_organization_id,
    v_member_id,
    p_role_code,
    p_scope_type,
    p_scope_id,
    now(),
    null,
    v_reason
  );

  return jsonb_build_object(
    'membership_id', v_member_id,
    'role_assignment_id', v_assignment_id,
    'status', 'INVITED'
  );
end;
$$;
revoke all on function private.register_invited_member_v4_impl(uuid,uuid,text,text,text,text,uuid,uuid,text) from public;
grant execute on function private.register_invited_member_v4_impl(uuid,uuid,text,text,text,text,uuid,uuid,text) to authenticated, service_role;

create or replace function public.register_invited_member_v4(
  p_organization_id uuid,
  p_user_id uuid,
  p_email text,
  p_display_name text,
  p_role_code text,
  p_scope_type text default null,
  p_scope_id uuid default null,
  p_department_id uuid default null,
  p_reason text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.register_invited_member_v4_impl(
    p_organization_id, p_user_id, p_email, p_display_name,
    p_role_code, p_scope_type, p_scope_id, p_department_id, p_reason
  );
$$;
revoke all on function public.register_invited_member_v4(uuid,uuid,text,text,text,text,uuid,uuid,text) from public;
grant execute on function public.register_invited_member_v4(uuid,uuid,text,text,text,text,uuid,uuid,text) to authenticated;

create or replace function private.activate_my_invited_memberships_v4_impl()
returns table(membership_id uuid, organization_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not exists (
    select 1 from auth.users u
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  ) then raise exception 'CONFIRMED_AUTH_USER_REQUIRED'; end if;

  perform set_config('meicare.audit_reason', 'Invitation accepted by authenticated user', true);

  return query
  update public.organization_members om
  set status = 'ACTIVE'
  where om.user_id = (select auth.uid())
    and om.status = 'INVITED'
  returning om.id, om.organization_id, om.status::text;
end;
$$;
revoke all on function private.activate_my_invited_memberships_v4_impl() from public;
grant execute on function private.activate_my_invited_memberships_v4_impl() to authenticated;

create or replace function public.activate_my_invited_memberships_v4()
returns table(membership_id uuid, organization_id uuid, status text)
language sql
security invoker
set search_path = ''
as $$
  select * from private.activate_my_invited_memberships_v4_impl();
$$;
revoke all on function public.activate_my_invited_memberships_v4() from public;
grant execute on function public.activate_my_invited_memberships_v4() to authenticated;

create or replace function private.set_member_status_v4_impl(
  p_organization_id uuid,
  p_membership_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_status text;
  v_new_status text;
  v_reason text;
  v_is_current_owner boolean;
  v_assignment record;
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not private.has_scoped_permission_v4(p_organization_id, 'membership.manage', null, null) then
    raise exception 'MEMBERSHIP_MANAGE_PERMISSION_REQUIRED';
  end if;

  v_new_status := upper(trim(coalesce(p_status, '')));
  if v_new_status not in ('ACTIVE','SUSPENDED','DISABLED') then raise exception 'INVALID_MEMBER_STATUS'; end if;
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'AUDIT_REASON_REQUIRED'; end if;

  select om.status::text into v_old_status
  from public.organization_members om
  where om.id = p_membership_id and om.organization_id = p_organization_id
  for update;
  if v_old_status is null then raise exception 'MEMBERSHIP_NOT_FOUND'; end if;
  if v_old_status = 'INVITED' and v_new_status = 'ACTIVE' then raise exception 'INVITED_MUST_SELF_ACTIVATE'; end if;
  if v_old_status = v_new_status then
    return jsonb_build_object('membership_id', p_membership_id, 'status', v_old_status, 'changed', false);
  end if;

  select exists (
    select 1
    from public.membership_roles mr
    join public.roles r on r.id = mr.role_id
    where mr.membership_id = p_membership_id
      and r.code = 'OWNER'
      and mr.scope_type = 'ORGANIZATION'
      and mr.scope_id is null
      and mr.valid_from <= now()
      and (mr.valid_to is null or mr.valid_to > now())
  ) into v_is_current_owner;
  if v_is_current_owner and v_new_status <> 'ACTIVE' then raise exception 'OWNER_STATUS_PROTECTED'; end if;

  perform set_config('meicare.audit_reason', left(v_reason, 1000), true);

  if v_new_status = 'DISABLED' then
    for v_assignment in
      select mr.id
      from public.membership_roles mr
      join public.roles r on r.id = mr.role_id
      where mr.membership_id = p_membership_id
        and r.code <> 'OWNER'
        and mr.valid_from <= now()
        and mr.valid_to is null
      for update of mr
    loop
      perform private.end_membership_role_v4_impl(
        p_organization_id, v_assignment.id, now(), 'Member disabled: ' || v_reason
      );
    end loop;
  end if;

  update public.organization_members
  set status = v_new_status::public.member_status
  where id = p_membership_id and organization_id = p_organization_id;

  return jsonb_build_object(
    'membership_id', p_membership_id,
    'previous_status', v_old_status,
    'status', v_new_status,
    'changed', true
  );
end;
$$;
revoke all on function private.set_member_status_v4_impl(uuid,uuid,text,text) from public;
grant execute on function private.set_member_status_v4_impl(uuid,uuid,text,text) to authenticated, service_role;

create or replace function public.set_member_status_v4(
  p_organization_id uuid,
  p_membership_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.set_member_status_v4_impl(p_organization_id, p_membership_id, p_status, p_reason);
$$;
revoke all on function public.set_member_status_v4(uuid,uuid,text,text) from public;
grant execute on function public.set_member_status_v4(uuid,uuid,text,text) to authenticated;

create or replace function private.list_member_admin_v4_impl(p_organization_id uuid)
returns table(
  membership_id uuid,
  user_id uuid,
  display_name text,
  email text,
  member_status text,
  legacy_role text,
  department_id uuid,
  department_name text,
  invited_at timestamptz,
  activated_at timestamptz,
  joined_at timestamptz,
  ended_at timestamptz,
  status_changed_at timestamptz,
  status_reason text,
  current_roles jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not private.has_scoped_permission_v4(p_organization_id, 'membership.manage', null, null) then
    raise exception 'MEMBERSHIP_MANAGE_PERMISSION_REQUIRED';
  end if;

  return query
  select
    om.id,
    om.user_id,
    om.display_name,
    om.email,
    om.status::text,
    om.role::text,
    om.department_id,
    d.name,
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
    ), '[]'::jsonb)
  from public.organization_members om
  left join public.departments d on d.id = om.department_id
  where om.organization_id = p_organization_id
  order by
    case om.status when 'ACTIVE' then 1 when 'INVITED' then 2 when 'SUSPENDED' then 3 else 4 end,
    om.display_name nulls last,
    om.email nulls last;
end;
$$;
revoke all on function private.list_member_admin_v4_impl(uuid) from public;
grant execute on function private.list_member_admin_v4_impl(uuid) to authenticated, service_role;

create or replace function public.list_member_admin_v4(p_organization_id uuid)
returns table(
  membership_id uuid,
  user_id uuid,
  display_name text,
  email text,
  member_status text,
  legacy_role text,
  department_id uuid,
  department_name text,
  invited_at timestamptz,
  activated_at timestamptz,
  joined_at timestamptz,
  ended_at timestamptz,
  status_changed_at timestamptz,
  status_reason text,
  current_roles jsonb
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.list_member_admin_v4_impl(p_organization_id);
$$;
revoke all on function public.list_member_admin_v4(uuid) from public;
grant execute on function public.list_member_admin_v4(uuid) to authenticated;

create or replace function private.list_member_lifecycle_history_v4_impl(
  p_organization_id uuid,
  p_membership_id uuid default null
)
returns table(
  audit_id bigint,
  action text,
  membership_id uuid,
  actor_user_id uuid,
  actor_membership_id uuid,
  reason text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'HUMAN_AUTH_REQUIRED'; end if;
  if not (
    private.has_scoped_permission_v4(p_organization_id, 'membership.manage', null, null)
    or private.has_scoped_permission_v4(p_organization_id, 'audit.view', null, null)
  ) then raise exception 'MEMBER_HISTORY_PERMISSION_REQUIRED'; end if;

  return query
  select
    a.id,
    a.action,
    nullif(a.entity_id, '')::uuid,
    a.actor_user_id,
    a.actor_membership_id,
    a.reason,
    a.old_value,
    a.new_value,
    a.created_at
  from public.audit_logs a
  where a.organization_id = p_organization_id
    and a.entity_type = 'ORGANIZATION_MEMBER'
    and a.source_type = 'MEMBER_LIFECYCLE_V4'
    and (p_membership_id is null or a.entity_id = p_membership_id::text)
  order by a.created_at desc, a.id desc;
end;
$$;
revoke all on function private.list_member_lifecycle_history_v4_impl(uuid,uuid) from public;
grant execute on function private.list_member_lifecycle_history_v4_impl(uuid,uuid) to authenticated, service_role;

create or replace function public.list_member_lifecycle_history_v4(
  p_organization_id uuid,
  p_membership_id uuid default null
)
returns table(
  audit_id bigint,
  action text,
  membership_id uuid,
  actor_user_id uuid,
  actor_membership_id uuid,
  reason text,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.list_member_lifecycle_history_v4_impl(p_organization_id, p_membership_id);
$$;
revoke all on function public.list_member_lifecycle_history_v4(uuid,uuid) from public;
grant execute on function public.list_member_lifecycle_history_v4(uuid,uuid) to authenticated;

-- Keep client mutation paths explicit and RPC-only.
revoke insert, update, delete on public.organization_members from authenticated;
