begin;

-- Run only if the V4_013D migration must be reverted before promotion.
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
    and not p.prosecdef;

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
    and p.prosecdef;

  if v_public_count <> 13 or v_private_count <> 13 then
    raise exception 'V4_013D_ROLLBACK_PRECONDITION_FAILED: public %, private %', v_public_count, v_private_count;
  end if;
end
$$;

drop function public.approve_par_proposals(uuid, uuid[]);
drop function public.bootstrap_organization(text, text, boolean);
drop function public.change_drug_code_v3(uuid, uuid, text, text);
drop function public.commit_inventory_period_report(uuid, date, date, jsonb, text, text);
drop function public.commit_inventory_snapshot_v2(uuid, jsonb, text, timestamp with time zone, text, text, text, boolean, jsonb);
drop function public.provision_his_connection_v2(uuid, text, text);
drop function public.refresh_inventory_risks(uuid);
drop function public.refresh_par_proposals(uuid);
drop function public.refresh_stock_position_alerts(uuid);
drop function public.revoke_his_connection_v2(uuid, uuid);
drop function public.update_action_status(uuid, public.action_status);
drop function public.update_inventory_policy_settings(uuid, integer, integer, integer, numeric);
drop function public.upsert_stock_policies(uuid, jsonb, text);

alter function private.approve_par_proposals(uuid, uuid[]) set schema public;
alter function private.bootstrap_organization(text, text, boolean) set schema public;
alter function private.change_drug_code_v3(uuid, uuid, text, text) set schema public;
alter function private.commit_inventory_period_report(uuid, date, date, jsonb, text, text) set schema public;
alter function private.commit_inventory_snapshot_v2(uuid, jsonb, text, timestamp with time zone, text, text, text, boolean, jsonb) set schema public;
alter function private.provision_his_connection_v2(uuid, text, text) set schema public;
alter function private.refresh_inventory_risks(uuid) set schema public;
alter function private.refresh_par_proposals(uuid) set schema public;
alter function private.refresh_stock_position_alerts(uuid) set schema public;
alter function private.revoke_his_connection_v2(uuid, uuid) set schema public;
alter function private.update_action_status(uuid, public.action_status) set schema public;
alter function private.update_inventory_policy_settings(uuid, integer, integer, integer, numeric) set schema public;
alter function private.upsert_stock_policies(uuid, jsonb, text) set schema public;

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

notify pgrst, 'reload schema';

commit;
