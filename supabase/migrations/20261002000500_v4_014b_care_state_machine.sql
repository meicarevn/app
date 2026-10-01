begin;

-- MEICARE V4_014B — Commercial Pharmacy Care State Machine
-- SOURCE PACKAGE ONLY. Do not apply to production without the controlled
-- activation gates in docs/V4_014B_CARE_STATE_MACHINE.md.

do $preflight$
begin
  if to_regclass('public.organizations') is null
     or to_regclass('public.organization_members') is null
     or to_regclass('public.warehouses') is null
     or to_regclass('public.departments') is null
     or to_regclass('public.permissions') is null
     or to_regclass('public.audit_logs') is null then
    raise exception 'V4_014B_REQUIRED_COMMERCIAL_SCHEMA_MISSING';
  end if;

  if to_regprocedure('private.has_scoped_permission_v4(uuid,text,uuid,uuid)') is null then
    raise exception 'V4_014B_SCOPED_PERMISSION_HELPER_MISSING';
  end if;

  if not has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'V4_014B_PRIVATE_SCHEMA_USAGE_REQUIRED';
  end if;

  if not exists (select 1 from public.permissions p where p.code = 'workflow.view') then
    raise exception 'V4_014B_WORKFLOW_VIEW_PERMISSION_MISSING';
  end if;

  -- V4_014B deliberately does not create a new write permission. Commercial
  -- activation is fail-closed until governance has already established it.
  if not exists (select 1 from public.permissions p where p.code = 'workflow.manage') then
    raise exception 'V4_014B_WORKFLOW_MANAGE_PERMISSION_MISSING';
  end if;
end
$preflight$;

create table if not exists private.care_policy_versions_v4 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_code text not null,
  policy_version integer not null check (policy_version > 0),
  status text not null check (status in ('DRAFT','ACTIVE','RETIRED')),
  title text not null check (char_length(trim(title)) between 1 and 240),
  rules jsonb not null default '{}'::jsonb check (jsonb_typeof(rules) = 'object'),
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (organization_id, policy_code, policy_version),
  check (policy_code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$')
);

create table if not exists private.care_signals_v4 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id),
  org_unit_id uuid references public.departments(id),
  policy_version_id uuid not null references private.care_policy_versions_v4(id),
  source_type text not null check (source_type ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  source_ref text not null check (source_ref ~ '^[A-Za-z0-9._:-]{1,160}$'),
  signal_type text not null check (signal_type ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  dedupe_key text not null check (dedupe_key ~ '^[A-Za-z0-9._:-]{1,180}$'),
  data_classification text not null check (data_classification in ('SYNTHETIC','DEIDENTIFIED','AGGREGATE')),
  created_at timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);

create table if not exists private.care_cases_v4 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  signal_id uuid not null unique references private.care_signals_v4(id),
  policy_version_id uuid not null references private.care_policy_versions_v4(id),
  warehouse_id uuid references public.warehouses(id),
  org_unit_id uuid references public.departments(id),
  priority text not null check (priority in ('P0','P1','P2','P3')),
  reason_code text not null check (reason_code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  recommended_action_code text not null check (recommended_action_code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  recommended_action_text text not null check (char_length(trim(recommended_action_text)) between 1 and 500),
  human_decision text not null default 'PENDING' check (human_decision in ('PENDING','ACCEPT','REJECT')),
  decision_reason_code text,
  decided_by uuid,
  decided_membership_id uuid references public.organization_members(id),
  decided_at timestamptz,
  owner_membership_id uuid references public.organization_members(id),
  due_at timestamptz,
  status text not null default 'PENDING_DECISION'
    check (status in ('PENDING_DECISION','ACCEPTED','IN_PROGRESS','REJECTED','CLOSED')),
  first_action_at timestamptz,
  verified_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  check (decision_reason_code is null or decision_reason_code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),

  -- PENDING has no owner/SLA, action, verification or close state.
  check (
    human_decision <> 'PENDING'
    or (
      status = 'PENDING_DECISION'
      and decision_reason_code is null
      and decided_by is null
      and decided_membership_id is null
      and decided_at is null
      and owner_membership_id is null
      and due_at is null
      and first_action_at is null
      and verified_at is null
      and closed_at is null
    )
  ),

  -- REJECT is terminal evidence of a human decision, not a task. It must not
  -- create Owner/SLA, action, verification or synthetic completion evidence.
  check (
    human_decision <> 'REJECT'
    or (
      status = 'REJECTED'
      and decision_reason_code is not null
      and decided_by is not null
      and decided_membership_id is not null
      and decided_at is not null
      and owner_membership_id is null
      and due_at is null
      and first_action_at is null
      and verified_at is null
      and closed_at is null
    )
  ),

  -- ACCEPT creates accountable work: owner + due time are mandatory.
  check (
    human_decision <> 'ACCEPT'
    or (
      decision_reason_code is not null
      and decided_by is not null
      and decided_membership_id is not null
      and decided_at is not null
      and owner_membership_id is not null
      and due_at is not null
      and status in ('ACCEPTED','IN_PROGRESS','CLOSED')
    )
  ),

  check (
    status <> 'ACCEPTED'
    or (
      human_decision = 'ACCEPT'
      and first_action_at is null
      and verified_at is null
      and closed_at is null
    )
  ),

  check (
    status <> 'IN_PROGRESS'
    or (
      human_decision = 'ACCEPT'
      and first_action_at is not null
      and verified_at is null
      and closed_at is null
    )
  ),

  -- Verification-before-close is structural, not a UI convention.
  check (
    status <> 'CLOSED'
    or (
      human_decision = 'ACCEPT'
      and first_action_at is not null
      and verified_at is not null
      and closed_at is not null
      and first_action_at <= verified_at
      and verified_at <= closed_at
    )
  ),

  check (decided_at is null or due_at is null or due_at > decided_at)
);

create table if not exists private.care_case_events_v4 (
  id bigint generated by default as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references private.care_cases_v4(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'CASE_CREATED',
      'DECISION_ACCEPTED',
      'DECISION_REJECTED',
      'ACTION_RECORDED',
      'CASE_VERIFIED',
      'CASE_CLOSED'
    )
  ),
  actor_user_id uuid,
  actor_membership_id uuid references public.organization_members(id),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists private.care_case_verifications_v4 (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null unique references private.care_cases_v4(id) on delete cascade,
  outcome_code text not null check (outcome_code ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  evidence_type text not null check (evidence_type ~ '^[A-Z0-9][A-Z0-9_-]{0,63}$'),
  evidence_ref text not null check (evidence_ref ~ '^[A-Za-z0-9._:/-]{1,240}$'),
  verified_by uuid not null,
  verified_membership_id uuid not null references public.organization_members(id),
  verified_at timestamptz not null default now()
);

create index if not exists care_policy_versions_v4_org_idx
  on private.care_policy_versions_v4(organization_id, policy_code, policy_version desc);
create index if not exists care_signals_v4_scope_idx
  on private.care_signals_v4(organization_id, warehouse_id, org_unit_id, created_at desc);
create index if not exists care_cases_v4_queue_idx
  on private.care_cases_v4(organization_id, status, priority, due_at, created_at desc);
create index if not exists care_cases_v4_owner_idx
  on private.care_cases_v4(owner_membership_id, status, due_at);
create index if not exists care_case_events_v4_case_idx
  on private.care_case_events_v4(case_id, created_at, id);

alter table private.care_policy_versions_v4 enable row level security;
alter table private.care_signals_v4 enable row level security;
alter table private.care_cases_v4 enable row level security;
alter table private.care_case_events_v4 enable row level security;
alter table private.care_case_verifications_v4 enable row level security;

revoke all on private.care_policy_versions_v4 from public, anon, authenticated, service_role;
revoke all on private.care_signals_v4 from public, anon, authenticated, service_role;
revoke all on private.care_cases_v4 from public, anon, authenticated, service_role;
revoke all on private.care_case_events_v4 from public, anon, authenticated, service_role;
revoke all on private.care_case_verifications_v4 from public, anon, authenticated, service_role;

-- SECURITY INVOKER public views need SELECT on their private base relations.
-- The private schema is not exposed through the Data API and RLS remains the
-- final row authority.
grant select on private.care_policy_versions_v4 to authenticated, service_role;
grant select on private.care_signals_v4 to authenticated, service_role;
grant select on private.care_cases_v4 to authenticated, service_role;
grant select on private.care_case_events_v4 to authenticated, service_role;
grant select on private.care_case_verifications_v4 to authenticated, service_role;

drop policy if exists care_policy_versions_v4_select on private.care_policy_versions_v4;
create policy care_policy_versions_v4_select
on private.care_policy_versions_v4
for select to authenticated
using (
  private.has_scoped_permission_v4(organization_id, 'workflow.view', null, null)
);

drop policy if exists care_signals_v4_select on private.care_signals_v4;
create policy care_signals_v4_select
on private.care_signals_v4
for select to authenticated
using (
  private.has_scoped_permission_v4(organization_id, 'workflow.view', warehouse_id, org_unit_id)
);

drop policy if exists care_cases_v4_select on private.care_cases_v4;
create policy care_cases_v4_select
on private.care_cases_v4
for select to authenticated
using (
  private.has_scoped_permission_v4(organization_id, 'workflow.view', warehouse_id, org_unit_id)
);

drop policy if exists care_case_events_v4_select on private.care_case_events_v4;
create policy care_case_events_v4_select
on private.care_case_events_v4
for select to authenticated
using (
  exists (
    select 1
    from private.care_cases_v4 c
    where c.id = case_id
      and c.organization_id = organization_id
      and private.has_scoped_permission_v4(
        c.organization_id, 'workflow.view', c.warehouse_id, c.org_unit_id
      )
  )
);

drop policy if exists care_case_verifications_v4_select on private.care_case_verifications_v4;
create policy care_case_verifications_v4_select
on private.care_case_verifications_v4
for select to authenticated
using (
  exists (
    select 1
    from private.care_cases_v4 c
    where c.id = case_id
      and c.organization_id = organization_id
      and private.has_scoped_permission_v4(
        c.organization_id, 'workflow.view', c.warehouse_id, c.org_unit_id
      )
  )
);

create or replace function private.reject_care_append_only_mutation_v4()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'CARE_APPEND_ONLY_RECORD_IMMUTABLE';
end;
$$;
revoke all on function private.reject_care_append_only_mutation_v4() from public, anon, authenticated, service_role;

drop trigger if exists trg_care_policy_versions_v4_immutable on private.care_policy_versions_v4;
create trigger trg_care_policy_versions_v4_immutable
before update or delete on private.care_policy_versions_v4
for each row execute function private.reject_care_append_only_mutation_v4();

drop trigger if exists trg_care_signals_v4_immutable on private.care_signals_v4;
create trigger trg_care_signals_v4_immutable
before update or delete on private.care_signals_v4
for each row execute function private.reject_care_append_only_mutation_v4();

drop trigger if exists trg_care_case_events_v4_immutable on private.care_case_events_v4;
create trigger trg_care_case_events_v4_immutable
before update or delete on private.care_case_events_v4
for each row execute function private.reject_care_append_only_mutation_v4();

drop trigger if exists trg_care_case_verifications_v4_immutable on private.care_case_verifications_v4;
create trigger trg_care_case_verifications_v4_immutable
before update or delete on private.care_case_verifications_v4
for each row execute function private.reject_care_append_only_mutation_v4();

create or replace function private.care_token_v4(p_value text, p_label text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v text := upper(trim(coalesce(p_value, '')));
begin
  if v !~ '^[A-Z0-9][A-Z0-9_-]{0,63}$' then
    raise exception 'INVALID_CARE_TOKEN:%', p_label;
  end if;
  return v;
end;
$$;
revoke all on function private.care_token_v4(text,text) from public, anon;
grant execute on function private.care_token_v4(text,text) to authenticated, service_role;

create or replace function private.care_actor_membership_v4(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'HUMAN_AUTH_REQUIRED';
  end if;

  select om.id into v_membership
  from public.organization_members om
  where om.organization_id = p_organization_id
    and om.user_id = (select auth.uid())
    and om.status::text = 'ACTIVE'
  order by om.joined_at nulls last, om.id
  limit 1;

  if v_membership is null then
    raise exception 'ACTIVE_ORGANIZATION_MEMBERSHIP_REQUIRED';
  end if;
  return v_membership;
end;
$$;
revoke all on function private.care_actor_membership_v4(uuid) from public, anon, authenticated, service_role;

create or replace function private.care_assert_manage_scope_v4(
  p_organization_id uuid,
  p_warehouse_id uuid,
  p_org_unit_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'HUMAN_AUTH_REQUIRED';
  end if;
  if not private.has_scoped_permission_v4(
    p_organization_id, 'workflow.manage', p_warehouse_id, p_org_unit_id
  ) then
    raise exception 'WORKFLOW_MANAGE_PERMISSION_REQUIRED';
  end if;
end;
$$;
revoke all on function private.care_assert_manage_scope_v4(uuid,uuid,uuid) from public, anon, authenticated, service_role;

create or replace function private.register_care_policy_v4_impl(
  p_organization_id uuid,
  p_policy_code text,
  p_policy_version integer,
  p_status text,
  p_title text,
  p_rules jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_code text;
  v_status text;
begin
  v_code := private.care_token_v4(p_policy_code, 'POLICY_CODE');
  v_status := private.care_token_v4(p_status, 'POLICY_STATUS');
  if v_status not in ('DRAFT','ACTIVE','RETIRED') then
    raise exception 'INVALID_CARE_POLICY_STATUS';
  end if;
  if p_policy_version is null or p_policy_version < 1 then
    raise exception 'INVALID_CARE_POLICY_VERSION';
  end if;
  if not exists (select 1 from public.organizations o where o.id = p_organization_id and o.active = true) then
    raise exception 'ORGANIZATION_NOT_FOUND_OR_INACTIVE';
  end if;
  if jsonb_typeof(coalesce(p_rules, '{}'::jsonb)) <> 'object' then
    raise exception 'CARE_POLICY_RULES_MUST_BE_OBJECT';
  end if;

  insert into private.care_policy_versions_v4(
    organization_id, policy_code, policy_version, status, title, rules
  ) values (
    p_organization_id, v_code, p_policy_version, v_status,
    left(trim(p_title), 240), coalesce(p_rules, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.register_care_policy_v4(
  p_organization_id uuid,
  p_policy_code text,
  p_policy_version integer,
  p_status text,
  p_title text,
  p_rules jsonb default '{}'::jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.register_care_policy_v4_impl(
    p_organization_id, p_policy_code, p_policy_version, p_status, p_title, p_rules
  );
$$;

revoke all on function private.register_care_policy_v4_impl(uuid,text,integer,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function private.register_care_policy_v4_impl(uuid,text,integer,text,text,jsonb)
  to service_role;
revoke all on function public.register_care_policy_v4(uuid,text,integer,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.register_care_policy_v4(uuid,text,integer,text,text,jsonb)
  to service_role;

create or replace function private.register_care_case_v4_impl(
  p_organization_id uuid,
  p_warehouse_id uuid,
  p_org_unit_id uuid,
  p_policy_version_id uuid,
  p_source_type text,
  p_source_ref text,
  p_signal_type text,
  p_dedupe_key text,
  p_data_classification text,
  p_priority text,
  p_reason_code text,
  p_recommended_action_code text,
  p_recommended_action_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signal_id uuid;
  v_case_id uuid;
  v_policy_org uuid;
  v_policy_status text;
  v_warehouse_org uuid;
  v_warehouse_org_unit uuid;
  v_org_unit uuid := p_org_unit_id;
  v_class text;
  v_priority text;
  v_reason text;
  v_action_code text;
begin
  select p.organization_id, p.status
  into v_policy_org, v_policy_status
  from private.care_policy_versions_v4 p
  where p.id = p_policy_version_id;

  if v_policy_org is null or v_policy_org <> p_organization_id then
    raise exception 'CARE_POLICY_ORGANIZATION_MISMATCH';
  end if;
  if v_policy_status <> 'ACTIVE' then
    raise exception 'CARE_POLICY_NOT_ACTIVE';
  end if;

  if p_warehouse_id is not null then
    select w.organization_id, w.org_unit_id
    into v_warehouse_org, v_warehouse_org_unit
    from public.warehouses w
    where w.id = p_warehouse_id and w.active = true;

    if v_warehouse_org is null or v_warehouse_org <> p_organization_id then
      raise exception 'CARE_WAREHOUSE_OUTSIDE_ORGANIZATION';
    end if;

    if v_org_unit is null then
      v_org_unit := v_warehouse_org_unit;
    elsif v_warehouse_org_unit is not null and v_org_unit <> v_warehouse_org_unit then
      raise exception 'CARE_SCOPE_MISMATCH';
    end if;
  end if;

  if v_org_unit is not null and not exists (
    select 1
    from public.departments d
    where d.id = v_org_unit
      and d.organization_id = p_organization_id
      and d.active = true
  ) then
    raise exception 'CARE_ORG_UNIT_OUTSIDE_ORGANIZATION';
  end if;

  if trim(coalesce(p_source_ref, '')) !~ '^[A-Za-z0-9._:-]{1,160}$'
     or trim(coalesce(p_dedupe_key, '')) !~ '^[A-Za-z0-9._:-]{1,180}$' then
    raise exception 'INVALID_CARE_OPAQUE_REFERENCE';
  end if;

  v_class := private.care_token_v4(p_data_classification, 'DATA_CLASSIFICATION');
  if v_class not in ('SYNTHETIC','DEIDENTIFIED','AGGREGATE') then
    raise exception 'IDENTIFIABLE_CARE_DATA_NOT_ALLOWED';
  end if;

  v_priority := private.care_token_v4(p_priority, 'PRIORITY');
  if v_priority not in ('P0','P1','P2','P3') then
    raise exception 'INVALID_CARE_PRIORITY';
  end if;

  v_reason := private.care_token_v4(p_reason_code, 'REASON_CODE');
  v_action_code := private.care_token_v4(p_recommended_action_code, 'ACTION_CODE');

  if nullif(trim(coalesce(p_recommended_action_text, '')), '') is null then
    raise exception 'CARE_RECOMMENDED_ACTION_REQUIRED';
  end if;

  insert into private.care_signals_v4(
    organization_id, warehouse_id, org_unit_id, policy_version_id,
    source_type, source_ref, signal_type, dedupe_key, data_classification
  ) values (
    p_organization_id, p_warehouse_id, v_org_unit, p_policy_version_id,
    private.care_token_v4(p_source_type, 'SOURCE_TYPE'),
    trim(p_source_ref),
    private.care_token_v4(p_signal_type, 'SIGNAL_TYPE'),
    trim(p_dedupe_key),
    v_class
  ) returning id into v_signal_id;

  insert into private.care_cases_v4(
    organization_id, signal_id, policy_version_id, warehouse_id, org_unit_id,
    priority, reason_code, recommended_action_code, recommended_action_text
  ) values (
    p_organization_id, v_signal_id, p_policy_version_id, p_warehouse_id, v_org_unit,
    v_priority, v_reason, v_action_code, left(trim(p_recommended_action_text), 500)
  ) returning id into v_case_id;

  insert into private.care_case_events_v4(
    organization_id, case_id, event_type, payload
  ) values (
    p_organization_id, v_case_id, 'CASE_CREATED',
    jsonb_build_object(
      'signal_id', v_signal_id,
      'policy_version_id', p_policy_version_id,
      'reason_code', v_reason,
      'recommended_action_code', v_action_code
    )
  );

  return jsonb_build_object('signal_id', v_signal_id, 'case_id', v_case_id);
end;
$$;

create or replace function public.register_care_case_v4(
  p_organization_id uuid,
  p_warehouse_id uuid,
  p_org_unit_id uuid,
  p_policy_version_id uuid,
  p_source_type text,
  p_source_ref text,
  p_signal_type text,
  p_dedupe_key text,
  p_data_classification text,
  p_priority text,
  p_reason_code text,
  p_recommended_action_code text,
  p_recommended_action_text text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.register_care_case_v4_impl(
    p_organization_id, p_warehouse_id, p_org_unit_id, p_policy_version_id,
    p_source_type, p_source_ref, p_signal_type, p_dedupe_key,
    p_data_classification, p_priority, p_reason_code,
    p_recommended_action_code, p_recommended_action_text
  );
$$;

revoke all on function private.register_care_case_v4_impl(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.register_care_case_v4_impl(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text)
  to service_role;
revoke all on function public.register_care_case_v4(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.register_care_case_v4(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text)
  to service_role;

create or replace function private.decide_care_case_v4_impl(
  p_organization_id uuid,
  p_case_id uuid,
  p_decision text,
  p_reason_code text,
  p_owner_membership_id uuid default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case private.care_cases_v4%rowtype;
  v_actor_membership uuid;
  v_decision text;
  v_reason text;
begin
  select * into v_case
  from private.care_cases_v4
  where id = p_case_id and organization_id = p_organization_id
  for update;

  if v_case.id is null then raise exception 'CARE_CASE_NOT_FOUND'; end if;

  perform private.care_assert_manage_scope_v4(
    v_case.organization_id, v_case.warehouse_id, v_case.org_unit_id
  );
  v_actor_membership := private.care_actor_membership_v4(p_organization_id);

  if v_case.human_decision <> 'PENDING' or v_case.status <> 'PENDING_DECISION' then
    raise exception 'CARE_CASE_ALREADY_DECIDED';
  end if;

  v_decision := private.care_token_v4(p_decision, 'DECISION');
  if v_decision not in ('ACCEPT','REJECT') then
    raise exception 'INVALID_CARE_DECISION';
  end if;
  v_reason := private.care_token_v4(p_reason_code, 'DECISION_REASON_CODE');

  if v_decision = 'REJECT' then
    if p_owner_membership_id is not null or p_due_at is not null then
      raise exception 'REJECT_MUST_NOT_CREATE_OWNER_OR_SLA';
    end if;

    update private.care_cases_v4
    set human_decision = 'REJECT',
        decision_reason_code = v_reason,
        decided_by = (select auth.uid()),
        decided_membership_id = v_actor_membership,
        decided_at = now(),
        status = 'REJECTED',
        updated_at = now()
    where id = p_case_id;

    insert into private.care_case_events_v4(
      organization_id, case_id, event_type, actor_user_id, actor_membership_id, payload
    ) values (
      p_organization_id, p_case_id, 'DECISION_REJECTED',
      (select auth.uid()), v_actor_membership,
      jsonb_build_object('reason_code', v_reason)
    );
  else
    if p_owner_membership_id is null or p_due_at is null then
      raise exception 'ACCEPT_REQUIRES_OWNER_AND_SLA';
    end if;
    if p_due_at <= now() then
      raise exception 'CARE_DUE_AT_MUST_BE_FUTURE';
    end if;
    if not exists (
      select 1
      from public.organization_members om
      where om.id = p_owner_membership_id
        and om.organization_id = p_organization_id
        and om.status::text = 'ACTIVE'
    ) then
      raise exception 'CARE_OWNER_MUST_BE_ACTIVE_ORGANIZATION_MEMBER';
    end if;

    update private.care_cases_v4
    set human_decision = 'ACCEPT',
        decision_reason_code = v_reason,
        decided_by = (select auth.uid()),
        decided_membership_id = v_actor_membership,
        decided_at = now(),
        owner_membership_id = p_owner_membership_id,
        due_at = p_due_at,
        status = 'ACCEPTED',
        updated_at = now()
    where id = p_case_id;

    insert into private.care_case_events_v4(
      organization_id, case_id, event_type, actor_user_id, actor_membership_id, payload
    ) values (
      p_organization_id, p_case_id, 'DECISION_ACCEPTED',
      (select auth.uid()), v_actor_membership,
      jsonb_build_object(
        'reason_code', v_reason,
        'owner_membership_id', p_owner_membership_id,
        'due_at', p_due_at
      )
    );
  end if;

  insert into public.audit_logs(
    organization_id, actor_user_id, actor_membership_id,
    action, entity_type, entity_id, old_value, new_value,
    source_type, reason, metadata
  ) values (
    p_organization_id, (select auth.uid()), v_actor_membership,
    case when v_decision = 'ACCEPT' then 'CARE_CASE_ACCEPTED' else 'CARE_CASE_REJECTED' end,
    'CARE_CASE_V4', p_case_id::text,
    jsonb_build_object('human_decision','PENDING','status','PENDING_DECISION'),
    jsonb_build_object(
      'human_decision', v_decision,
      'reason_code', v_reason,
      'owner_membership_id', p_owner_membership_id,
      'due_at', p_due_at
    ),
    'CARE_COORDINATION_V4', v_reason,
    jsonb_build_object('policy_version_id', v_case.policy_version_id)
  );

  return (
    select jsonb_build_object(
      'case_id', c.id,
      'human_decision', c.human_decision,
      'status', c.status,
      'owner_membership_id', c.owner_membership_id,
      'due_at', c.due_at
    )
    from private.care_cases_v4 c where c.id = p_case_id
  );
end;
$$;

create or replace function public.decide_care_case_v4(
  p_organization_id uuid,
  p_case_id uuid,
  p_decision text,
  p_reason_code text,
  p_owner_membership_id uuid default null,
  p_due_at timestamptz default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.decide_care_case_v4_impl(
    p_organization_id, p_case_id, p_decision, p_reason_code,
    p_owner_membership_id, p_due_at
  );
$$;

revoke all on function private.decide_care_case_v4_impl(uuid,uuid,text,text,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.decide_care_case_v4_impl(uuid,uuid,text,text,uuid,timestamptz)
  to authenticated;
revoke all on function public.decide_care_case_v4(uuid,uuid,text,text,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.decide_care_case_v4(uuid,uuid,text,text,uuid,timestamptz)
  to authenticated;

create or replace function private.record_care_action_v4_impl(
  p_organization_id uuid,
  p_case_id uuid,
  p_action_code text,
  p_action_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case private.care_cases_v4%rowtype;
  v_actor_membership uuid;
  v_action_code text;
  v_action_ref text;
begin
  select * into v_case
  from private.care_cases_v4
  where id = p_case_id and organization_id = p_organization_id
  for update;

  if v_case.id is null then raise exception 'CARE_CASE_NOT_FOUND'; end if;

  perform private.care_assert_manage_scope_v4(
    v_case.organization_id, v_case.warehouse_id, v_case.org_unit_id
  );
  v_actor_membership := private.care_actor_membership_v4(p_organization_id);

  if v_case.human_decision <> 'ACCEPT' then
    raise exception 'CARE_ACTION_REQUIRES_ACCEPT';
  end if;
  if v_case.status not in ('ACCEPTED','IN_PROGRESS') then
    raise exception 'CARE_CASE_NOT_ACTIONABLE';
  end if;

  v_action_code := private.care_token_v4(p_action_code, 'ACTION_CODE');
  v_action_ref := nullif(trim(coalesce(p_action_ref, '')), '');
  if v_action_ref is not null and v_action_ref !~ '^[A-Za-z0-9._:/-]{1,240}$' then
    raise exception 'INVALID_CARE_ACTION_REFERENCE';
  end if;

  update private.care_cases_v4
  set first_action_at = coalesce(first_action_at, now()),
      status = 'IN_PROGRESS',
      updated_at = now()
  where id = p_case_id;

  insert into private.care_case_events_v4(
    organization_id, case_id, event_type, actor_user_id, actor_membership_id, payload
  ) values (
    p_organization_id, p_case_id, 'ACTION_RECORDED',
    (select auth.uid()), v_actor_membership,
    jsonb_strip_nulls(jsonb_build_object(
      'action_code', v_action_code,
      'action_ref', v_action_ref
    ))
  );

  insert into public.audit_logs(
    organization_id, actor_user_id, actor_membership_id,
    action, entity_type, entity_id, new_value,
    source_type, reason, metadata
  ) values (
    p_organization_id, (select auth.uid()), v_actor_membership,
    'CARE_ACTION_RECORDED', 'CARE_CASE_V4', p_case_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'action_code', v_action_code,
      'action_ref', v_action_ref
    )),
    'CARE_COORDINATION_V4', v_action_code,
    jsonb_build_object('owner_membership_id', v_case.owner_membership_id)
  );

  return (
    select jsonb_build_object(
      'case_id', c.id,
      'status', c.status,
      'first_action_at', c.first_action_at
    )
    from private.care_cases_v4 c where c.id = p_case_id
  );
end;
$$;

create or replace function public.record_care_action_v4(
  p_organization_id uuid,
  p_case_id uuid,
  p_action_code text,
  p_action_ref text default null
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.record_care_action_v4_impl(
    p_organization_id, p_case_id, p_action_code, p_action_ref
  );
$$;

revoke all on function private.record_care_action_v4_impl(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.record_care_action_v4_impl(uuid,uuid,text,text)
  to authenticated;
revoke all on function public.record_care_action_v4(uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_care_action_v4(uuid,uuid,text,text)
  to authenticated;

create or replace function private.verify_close_care_case_v4_impl(
  p_organization_id uuid,
  p_case_id uuid,
  p_outcome_code text,
  p_evidence_type text,
  p_evidence_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case private.care_cases_v4%rowtype;
  v_actor_membership uuid;
  v_outcome text;
  v_evidence_type text;
  v_evidence_ref text;
  v_verified_at timestamptz := now();
begin
  select * into v_case
  from private.care_cases_v4
  where id = p_case_id and organization_id = p_organization_id
  for update;

  if v_case.id is null then raise exception 'CARE_CASE_NOT_FOUND'; end if;

  perform private.care_assert_manage_scope_v4(
    v_case.organization_id, v_case.warehouse_id, v_case.org_unit_id
  );
  v_actor_membership := private.care_actor_membership_v4(p_organization_id);

  if v_case.human_decision <> 'ACCEPT' then
    raise exception 'CARE_VERIFICATION_REQUIRES_ACCEPT';
  end if;
  if v_case.first_action_at is null or v_case.status <> 'IN_PROGRESS' then
    raise exception 'CARE_VERIFICATION_REQUIRES_ACTION';
  end if;
  if exists (
    select 1 from private.care_case_verifications_v4 v where v.case_id = p_case_id
  ) then
    raise exception 'CARE_CASE_ALREADY_VERIFIED';
  end if;

  v_outcome := private.care_token_v4(p_outcome_code, 'OUTCOME_CODE');
  v_evidence_type := private.care_token_v4(p_evidence_type, 'EVIDENCE_TYPE');
  v_evidence_ref := trim(coalesce(p_evidence_ref, ''));
  if v_evidence_ref !~ '^[A-Za-z0-9._:/-]{1,240}$' then
    raise exception 'INVALID_CARE_EVIDENCE_REFERENCE';
  end if;

  insert into private.care_case_verifications_v4(
    organization_id, case_id, outcome_code, evidence_type, evidence_ref,
    verified_by, verified_membership_id, verified_at
  ) values (
    p_organization_id, p_case_id, v_outcome, v_evidence_type, v_evidence_ref,
    (select auth.uid()), v_actor_membership, v_verified_at
  );

  insert into private.care_case_events_v4(
    organization_id, case_id, event_type, actor_user_id, actor_membership_id, payload, created_at
  ) values (
    p_organization_id, p_case_id, 'CASE_VERIFIED',
    (select auth.uid()), v_actor_membership,
    jsonb_build_object(
      'outcome_code', v_outcome,
      'evidence_type', v_evidence_type,
      'evidence_ref', v_evidence_ref
    ),
    v_verified_at
  );

  update private.care_cases_v4
  set verified_at = v_verified_at,
      closed_at = v_verified_at,
      status = 'CLOSED',
      updated_at = v_verified_at
  where id = p_case_id;

  insert into private.care_case_events_v4(
    organization_id, case_id, event_type, actor_user_id, actor_membership_id, payload, created_at
  ) values (
    p_organization_id, p_case_id, 'CASE_CLOSED',
    (select auth.uid()), v_actor_membership,
    jsonb_build_object('outcome_code', v_outcome),
    v_verified_at
  );

  insert into public.audit_logs(
    organization_id, actor_user_id, actor_membership_id,
    action, entity_type, entity_id, new_value,
    source_type, reason, metadata
  ) values (
    p_organization_id, (select auth.uid()), v_actor_membership,
    'CARE_CASE_VERIFIED_AND_CLOSED', 'CARE_CASE_V4', p_case_id::text,
    jsonb_build_object(
      'outcome_code', v_outcome,
      'evidence_type', v_evidence_type,
      'evidence_ref', v_evidence_ref,
      'verified_at', v_verified_at
    ),
    'CARE_COORDINATION_V4', v_outcome,
    jsonb_build_object('owner_membership_id', v_case.owner_membership_id)
  );

  return jsonb_build_object(
    'case_id', p_case_id,
    'status', 'CLOSED',
    'outcome_code', v_outcome,
    'verified_at', v_verified_at
  );
end;
$$;

create or replace function public.verify_close_care_case_v4(
  p_organization_id uuid,
  p_case_id uuid,
  p_outcome_code text,
  p_evidence_type text,
  p_evidence_ref text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.verify_close_care_case_v4_impl(
    p_organization_id, p_case_id, p_outcome_code, p_evidence_type, p_evidence_ref
  );
$$;

revoke all on function private.verify_close_care_case_v4_impl(uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function private.verify_close_care_case_v4_impl(uuid,uuid,text,text,text)
  to authenticated;
revoke all on function public.verify_close_care_case_v4(uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.verify_close_care_case_v4(uuid,uuid,text,text,text)
  to authenticated;

create or replace view public.care_queue_v4
with (security_invoker = true)
as
select
  c.organization_id,
  'CARE'::text as item_kind,
  c.id as item_id,
  'CARE_CASE'::text as source_type,
  s.source_ref as source_id,
  c.warehouse_id,
  c.org_unit_id,
  ('Tác vụ chăm sóc · ' || s.signal_type)::text as title,
  c.priority,
  c.status,
  c.human_decision,
  (c.owner_membership_id is not null) as owner_assigned,
  c.owner_membership_id,
  c.due_at,
  c.created_at,
  s.created_at as triggered_at,
  c.reason_code,
  c.recommended_action_code,
  c.recommended_action_text as recommended_action,
  p.policy_code,
  p.policy_version,
  (p.policy_code || '@' || p.policy_version::text)::text as engine_version
from private.care_cases_v4 c
join private.care_signals_v4 s on s.id = c.signal_id
join private.care_policy_versions_v4 p on p.id = c.policy_version_id;

create or replace view public.care_case_timeline_v4
with (security_invoker = true)
as
select
  e.organization_id,
  e.case_id,
  e.id as event_id,
  e.event_type,
  e.actor_membership_id,
  e.payload,
  e.created_at
from private.care_case_events_v4 e;

revoke all on public.care_queue_v4 from public, anon, authenticated, service_role;
revoke all on public.care_case_timeline_v4 from public, anon, authenticated, service_role;
grant select on public.care_queue_v4 to authenticated, service_role;
grant select on public.care_case_timeline_v4 to authenticated, service_role;

do $postconditions$
declare
  v_public_definers integer;
begin
  select count(*) into v_public_definers
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any(array[
      'register_care_policy_v4',
      'register_care_case_v4',
      'decide_care_case_v4',
      'record_care_action_v4',
      'verify_close_care_case_v4'
    ])
    and p.prosecdef;

  if v_public_definers <> 0 then
    raise exception 'V4_014B_PUBLIC_SECURITY_DEFINER_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'care_queue_v4'
      and c.reloptions @> array['security_invoker=true']
  ) then
    raise exception 'V4_014B_CARE_QUEUE_MUST_BE_SECURITY_INVOKER';
  end if;
end
$postconditions$;

notify pgrst, 'reload schema';

commit;
