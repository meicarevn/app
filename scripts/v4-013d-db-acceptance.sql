begin;

do $$
declare
  v_public_invoker integer;
  v_private_definer integer;
  v_public_auth integer;
  v_public_anon integer;
  v_private_public integer;
begin
  select count(*) into v_public_invoker
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

  select count(*) into v_private_definer
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

  select count(*) into v_public_auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any(array[
      'approve_par_proposals','bootstrap_organization','change_drug_code_v3',
      'commit_inventory_period_report','commit_inventory_snapshot_v2','provision_his_connection_v2',
      'refresh_inventory_risks','refresh_par_proposals','refresh_stock_position_alerts',
      'revoke_his_connection_v2','update_action_status','update_inventory_policy_settings',
      'upsert_stock_policies'
    ])
    and has_function_privilege('authenticated', p.oid, 'EXECUTE');

  select count(*) into v_public_anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = any(array[
      'approve_par_proposals','bootstrap_organization','change_drug_code_v3',
      'commit_inventory_period_report','commit_inventory_snapshot_v2','provision_his_connection_v2',
      'refresh_inventory_risks','refresh_par_proposals','refresh_stock_position_alerts',
      'revoke_his_connection_v2','update_action_status','update_inventory_policy_settings',
      'upsert_stock_policies'
    ])
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  select count(*) into v_private_public
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname = any(array[
      'approve_par_proposals','bootstrap_organization','change_drug_code_v3',
      'commit_inventory_period_report','commit_inventory_snapshot_v2','provision_his_connection_v2',
      'refresh_inventory_risks','refresh_par_proposals','refresh_stock_position_alerts',
      'revoke_his_connection_v2','update_action_status','update_inventory_policy_settings',
      'upsert_stock_policies'
    ])
    and has_function_privilege('anon', p.oid, 'EXECUTE');

  if v_public_invoker <> 13 or v_private_definer <> 13 or v_public_auth <> 13
     or v_public_anon <> 0 or v_private_public <> 0 then
    raise exception
      'V4_013D_ACCEPTANCE_FAILED: public_invoker %, private_definer %, public_auth %, public_anon %, private_anon %',
      v_public_invoker, v_private_definer, v_public_auth, v_public_anon, v_private_public;
  end if;
end
$$;

select n.nspname as schema_name,
       p.proname,
       p.prosecdef as security_definer,
       p.proconfig,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private')
  and p.proname = any(array[
    'approve_par_proposals','bootstrap_organization','change_drug_code_v3',
    'commit_inventory_period_report','commit_inventory_snapshot_v2','provision_his_connection_v2',
    'refresh_inventory_risks','refresh_par_proposals','refresh_stock_position_alerts',
    'revoke_his_connection_v2','update_action_status','update_inventory_policy_settings',
    'upsert_stock_policies'
  ])
order by p.proname, n.nspname;

rollback;
