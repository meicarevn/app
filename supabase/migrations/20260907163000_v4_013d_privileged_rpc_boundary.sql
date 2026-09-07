begin;

-- V4_013D keeps every public RPC signature stable while removing SECURITY
-- DEFINER from the exposed API schema. The existing, role-aware implementation
-- moves to private; a SECURITY INVOKER facade delegates to it.
do $$
declare
  v_expected text[] := array[
    'approve_par_proposals(uuid,uuid[])',
    'bootstrap_organization(text,text,boolean)',
    'change_drug_code_v3(uuid,uuid,text,text)',
    'commit_inventory_period_report(uuid,date,date,jsonb,text,text)',
    'commit_inventory_snapshot_v2(uuid,jsonb,text,timestamp with time zone,text,text,text,boolean,jsonb)',
    'provision_his_connection_v2(uuid,text,text)',
    'refresh_inventory_risks(uuid)',
    'refresh_par_proposals(uuid)',
    'refresh_stock_position_alerts(uuid)',
    'revoke_his_connection_v2(uuid,uuid)',
    'update_action_status(uuid,public.action_status)',
    'update_inventory_policy_settings(uuid,integer,integer,integer,numeric)',
    'upsert_stock_policies(uuid,jsonb,text)'
  ];
  v_signature text;
  v_oid oid;
begin
  if not has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'V4_013D_PRIVATE_SCHEMA_USAGE_REQUIRED';
  end if;

  foreach v_signature in array v_expected loop
    v_oid := to_regprocedure('public.' || v_signature);
    if v_oid is null then
      raise exception 'V4_013D_RPC_MISSING: %', v_signature;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = v_oid) then
      raise exception 'V4_013D_RPC_NOT_SECURITY_DEFINER: %', v_signature;
    end if;
    if not has_function_privilege('authenticated', v_oid, 'EXECUTE') then
      raise exception 'V4_013D_AUTHENTICATED_EXECUTE_MISSING: %', v_signature;
    end if;
    if to_regprocedure('private.' || v_signature) is not null then
      raise exception 'V4_013D_PRIVATE_COLLISION: %', v_signature;
    end if;
  end loop;
end
$$;

alter function public.approve_par_proposals(uuid, uuid[]) set schema private;
alter function public.bootstrap_organization(text, text, boolean) set schema private;
alter function public.change_drug_code_v3(uuid, uuid, text, text) set schema private;
alter function public.commit_inventory_period_report(uuid, date, date, jsonb, text, text) set schema private;
alter function public.commit_inventory_snapshot_v2(uuid, jsonb, text, timestamp with time zone, text, text, text, boolean, jsonb) set schema private;
alter function public.provision_his_connection_v2(uuid, text, text) set schema private;
alter function public.refresh_inventory_risks(uuid) set schema private;
alter function public.refresh_par_proposals(uuid) set schema private;
alter function public.refresh_stock_position_alerts(uuid) set schema private;
alter function public.revoke_his_connection_v2(uuid, uuid) set schema private;
alter function public.update_action_status(uuid, public.action_status) set schema private;
alter function public.update_inventory_policy_settings(uuid, integer, integer, integer, numeric) set schema private;
alter function public.upsert_stock_policies(uuid, jsonb, text) set schema private;

create function public.approve_par_proposals(
  p_organization_id uuid,
  p_proposal_ids uuid[]
) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.approve_par_proposals(p_organization_id, p_proposal_ids) $$;

create function public.bootstrap_organization(
  p_name text,
  p_code text default null::text,
  p_with_demo boolean default false
) returns uuid
language sql security invoker set search_path = ''
as $$ select private.bootstrap_organization(p_name, p_code, p_with_demo) $$;

create function public.change_drug_code_v3(
  p_organization_id uuid,
  p_drug_id uuid,
  p_new_code text,
  p_reason text default null::text
) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.change_drug_code_v3(p_organization_id, p_drug_id, p_new_code, p_reason) $$;

create function public.commit_inventory_period_report(
  p_organization_id uuid,
  p_period_start date,
  p_period_end date,
  p_rows jsonb,
  p_source_name text default 'HIS period report'::text,
  p_warehouse_code text default null::text
) returns jsonb
language sql security invoker set search_path = ''
set statement_timeout = '30s'
as $$
  select private.commit_inventory_period_report(
    p_organization_id, p_period_start, p_period_end, p_rows,
    p_source_name, p_warehouse_code
  )
$$;

create function public.commit_inventory_snapshot_v2(
  p_organization_id uuid,
  p_rows jsonb,
  p_source_name text,
  p_snapshot_at timestamp with time zone,
  p_coverage_type text default 'WAREHOUSE_SET_FULL'::text,
  p_file_sha256 text default null::text,
  p_content_hash text default null::text,
  p_allow_same_date_correction boolean default false,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language sql security invoker set search_path = ''
as $$
  select private.commit_inventory_snapshot_v2(
    p_organization_id, p_rows, p_source_name, p_snapshot_at,
    p_coverage_type, p_file_sha256, p_content_hash,
    p_allow_same_date_correction, p_metadata
  )
$$;

create function public.provision_his_connection_v2(
  p_organization_id uuid,
  p_source_system text,
  p_display_name text
) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.provision_his_connection_v2(p_organization_id, p_source_system, p_display_name) $$;

create function public.refresh_inventory_risks(
  p_organization_id uuid
) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.refresh_inventory_risks(p_organization_id) $$;

create function public.refresh_par_proposals(
  p_organization_id uuid
) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.refresh_par_proposals(p_organization_id) $$;

create function public.refresh_stock_position_alerts(
  p_organization_id uuid
) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.refresh_stock_position_alerts(p_organization_id) $$;

create function public.revoke_his_connection_v2(
  p_organization_id uuid,
  p_connection_id uuid
) returns boolean
language sql security invoker set search_path = ''
as $$ select private.revoke_his_connection_v2(p_organization_id, p_connection_id) $$;

create function public.update_action_status(
  p_action_id uuid,
  p_status public.action_status
) returns public.actions
language sql security invoker set search_path = ''
as $$ select private.update_action_status(p_action_id, p_status) $$;

create function public.update_inventory_policy_settings(
  p_organization_id uuid,
  p_lead_time_days integer,
  p_review_period_days integer,
  p_safety_stock_days integer,
  p_fallback_low_stock_percentage numeric default 30
) returns jsonb
language sql security invoker set search_path = ''
as $$
  select private.update_inventory_policy_settings(
    p_organization_id, p_lead_time_days, p_review_period_days,
    p_safety_stock_days, p_fallback_low_stock_percentage
  )
$$;

create function public.upsert_stock_policies(
  p_organization_id uuid,
  p_rows jsonb,
  p_source_name text default 'MEICARE PAR policy'::text
) returns jsonb
language sql security invoker set search_path = ''
as $$ select private.upsert_stock_policies(p_organization_id, p_rows, p_source_name) $$;

-- A moved function keeps its old ACL. Rebuild both sides explicitly so the
-- private implementation is callable only by roles needed by the facade.
revoke all on function private.approve_par_proposals(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.bootstrap_organization(text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function private.change_drug_code_v3(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.commit_inventory_period_report(uuid, date, date, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function private.commit_inventory_snapshot_v2(uuid, jsonb, text, timestamp with time zone, text, text, text, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.provision_his_connection_v2(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.refresh_inventory_risks(uuid) from public, anon, authenticated, service_role;
revoke all on function private.refresh_par_proposals(uuid) from public, anon, authenticated, service_role;
revoke all on function private.refresh_stock_position_alerts(uuid) from public, anon, authenticated, service_role;
revoke all on function private.revoke_his_connection_v2(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.update_action_status(uuid, public.action_status) from public, anon, authenticated, service_role;
revoke all on function private.update_inventory_policy_settings(uuid, integer, integer, integer, numeric) from public, anon, authenticated, service_role;
revoke all on function private.upsert_stock_policies(uuid, jsonb, text) from public, anon, authenticated, service_role;

grant execute on function private.approve_par_proposals(uuid, uuid[]) to authenticated;
grant execute on function private.bootstrap_organization(text, text, boolean) to authenticated, service_role;
grant execute on function private.change_drug_code_v3(uuid, uuid, text, text) to authenticated;
grant execute on function private.commit_inventory_period_report(uuid, date, date, jsonb, text, text) to authenticated, service_role;
grant execute on function private.commit_inventory_snapshot_v2(uuid, jsonb, text, timestamp with time zone, text, text, text, boolean, jsonb) to authenticated, service_role;
grant execute on function private.provision_his_connection_v2(uuid, text, text) to authenticated;
grant execute on function private.refresh_inventory_risks(uuid) to authenticated, service_role;
grant execute on function private.refresh_par_proposals(uuid) to authenticated, service_role;
grant execute on function private.refresh_stock_position_alerts(uuid) to authenticated, service_role;
grant execute on function private.revoke_his_connection_v2(uuid, uuid) to authenticated;
grant execute on function private.update_action_status(uuid, public.action_status) to authenticated;
grant execute on function private.update_inventory_policy_settings(uuid, integer, integer, integer, numeric) to authenticated;
grant execute on function private.upsert_stock_policies(uuid, jsonb, text) to authenticated;

revoke all on function public.approve_par_proposals(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.bootstrap_organization(text, text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.change_drug_code_v3(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.commit_inventory_period_report(uuid, date, date, jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function public.commit_inventory_snapshot_v2(uuid, jsonb, text, timestamp with time zone, text, text, text, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.provision_his_connection_v2(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.refresh_inventory_risks(uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_par_proposals(uuid) from public, anon, authenticated, service_role;
revoke all on function public.refresh_stock_position_alerts(uuid) from public, anon, authenticated, service_role;
revoke all on function public.revoke_his_connection_v2(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.update_action_status(uuid, public.action_status) from public, anon, authenticated, service_role;
revoke all on function public.update_inventory_policy_settings(uuid, integer, integer, integer, numeric) from public, anon, authenticated, service_role;
revoke all on function public.upsert_stock_policies(uuid, jsonb, text) from public, anon, authenticated, service_role;

grant execute on function public.approve_par_proposals(uuid, uuid[]) to authenticated;
grant execute on function public.bootstrap_organization(text, text, boolean) to authenticated, service_role;
grant execute on function public.change_drug_code_v3(uuid, uuid, text, text) to authenticated;
grant execute on function public.commit_inventory_period_report(uuid, date, date, jsonb, text, text) to authenticated, service_role;
grant execute on function public.commit_inventory_snapshot_v2(uuid, jsonb, text, timestamp with time zone, text, text, text, boolean, jsonb) to authenticated, service_role;
grant execute on function public.provision_his_connection_v2(uuid, text, text) to authenticated;
grant execute on function public.refresh_inventory_risks(uuid) to authenticated, service_role;
grant execute on function public.refresh_par_proposals(uuid) to authenticated, service_role;
grant execute on function public.refresh_stock_position_alerts(uuid) to authenticated, service_role;
grant execute on function public.revoke_his_connection_v2(uuid, uuid) to authenticated;
grant execute on function public.update_action_status(uuid, public.action_status) to authenticated;
grant execute on function public.update_inventory_policy_settings(uuid, integer, integer, integer, numeric) to authenticated;
grant execute on function public.upsert_stock_policies(uuid, jsonb, text) to authenticated;

do $$
declare
  v_public_count integer;
  v_private_count integer;
begin
  select count(*) into v_public_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any(array[
      'approve_par_proposals','bootstrap_organization','change_drug_code_v3',
      'commit_inventory_period_report','commit_inventory_snapshot_v2','provision_his_connection_v2',
      'refresh_inventory_risks','refresh_par_proposals','refresh_stock_position_alerts',
      'revoke_his_connection_v2','update_action_status','update_inventory_policy_settings',
      'upsert_stock_policies'
    ])
    and not p.prosecdef
    and p.proconfig @> array['search_path=""'];

  select count(*) into v_private_count
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = any(array[
      'approve_par_proposals','bootstrap_organization','change_drug_code_v3',
      'commit_inventory_period_report','commit_inventory_snapshot_v2','provision_his_connection_v2',
      'refresh_inventory_risks','refresh_par_proposals','refresh_stock_position_alerts',
      'revoke_his_connection_v2','update_action_status','update_inventory_policy_settings',
      'upsert_stock_policies'
    ])
    and p.prosecdef
    and p.proconfig @> array['search_path=""'];

  if v_public_count <> 13 or v_private_count <> 13 then
    raise exception 'V4_013D_POSTCONDITION_FAILED: public %, private %', v_public_count, v_private_count;
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
