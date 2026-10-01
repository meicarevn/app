-- V4_014C PostgreSQL 17 synthetic DB acceptance.
-- Run after:
--   1) test/fixtures/v4-014c-commercial-schema.sql
--   2) supabase/migrations/20261002000500_v4_014b_care_state_machine.sql
\set ON_ERROR_STOP on

create temp table v4_014c_results(
  test_id text primary key,
  pass boolean not null,
  detail text not null default ''
);
grant all on v4_014c_results to authenticated, service_role;

create temp table v4_014c_ctx(
  k text primary key,
  v text not null
);
grant all on v4_014c_ctx to authenticated, service_role;

create or replace function pg_temp.ok(p_id text, p_pass boolean, p_detail text default '')
returns void
language sql
as $$
  insert into v4_014c_results(test_id, pass, detail)
  values (p_id, coalesce(p_pass, false), coalesce(p_detail, ''))
  on conflict (test_id) do update
    set pass = excluded.pass, detail = excluded.detail;
$$;
grant execute on function pg_temp.ok(text,boolean,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Service-only policy / signal ingestion
-- ---------------------------------------------------------------------------
set role service_role;

insert into v4_014c_ctx(k,v)
select 'policy_a', public.register_care_policy_v4(
  '10000000-0000-4000-8000-000000000001',
  'CARE-CADENCE',
  1,
  'ACTIVE',
  'Synthetic cadence policy',
  '{"signal":"care-window"}'::jsonb
)::text;

insert into v4_014c_ctx(k,v)
select 'policy_b', public.register_care_policy_v4(
  '10000000-0000-4000-8000-000000000002',
  'CARE-CADENCE',
  1,
  'ACTIVE',
  'Synthetic cadence policy B',
  '{"signal":"care-window"}'::jsonb
)::text;

insert into v4_014c_ctx(k,v)
select 'case_accept', x->>'case_id'
from (
  select public.register_care_case_v4(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    (select v::uuid from v4_014c_ctx where k='policy_a'),
    'ERP_DERIVED',
    'SRC-A-001',
    'CARE_WINDOW',
    'A-ACCEPT-001',
    'SYNTHETIC',
    'P1',
    'CADENCE_REVIEW',
    'CONTACT_VERIFY',
    'Liên hệ xác minh nhu cầu chăm sóc'
  ) as x
) q;

insert into v4_014c_ctx(k,v)
select 'case_reject', x->>'case_id'
from (
  select public.register_care_case_v4(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    (select v::uuid from v4_014c_ctx where k='policy_a'),
    'ERP_DERIVED',
    'SRC-A-002',
    'CARE_WINDOW',
    'A-REJECT-001',
    'SYNTHETIC',
    'P2',
    'CADENCE_REVIEW',
    'CONTACT_VERIFY',
    'Liên hệ xác minh nhu cầu chăm sóc'
  ) as x
) q;

insert into v4_014c_ctx(k,v)
select 'case_pending', x->>'case_id'
from (
  select public.register_care_case_v4(
    '10000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    (select v::uuid from v4_014c_ctx where k='policy_a'),
    'ERP_DERIVED',
    'SRC-A-003',
    'CARE_WINDOW',
    'A-PENDING-001',
    'DEIDENTIFIED',
    'P2',
    'CADENCE_REVIEW',
    'CONTACT_VERIFY',
    'Liên hệ xác minh nhu cầu chăm sóc'
  ) as x
) q;

insert into v4_014c_ctx(k,v)
select 'case_b', x->>'case_id'
from (
  select public.register_care_case_v4(
    '10000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000002',
    (select v::uuid from v4_014c_ctx where k='policy_b'),
    'ERP_DERIVED',
    'SRC-B-001',
    'CARE_WINDOW',
    'B-PENDING-001',
    'AGGREGATE',
    'P3',
    'CADENCE_REVIEW',
    'CONTACT_VERIFY',
    'Liên hệ xác minh nhu cầu chăm sóc'
  ) as x
) q;

select pg_temp.ok(
  'C01_SERVICE_INGEST',
  (select count(*) from private.care_cases_v4) = 4,
  'Four synthetic/deidentified/aggregate cases registered'
);

do $$
begin
  begin
    perform public.register_care_case_v4(
      '10000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      (select v::uuid from v4_014c_ctx where k='policy_a'),
      'ERP_DERIVED',
      'SRC-A-BLOCKED',
      'CARE_WINDOW',
      'A-IDENTIFIABLE-BLOCKED',
      'IDENTIFIABLE',
      'P1',
      'CADENCE_REVIEW',
      'CONTACT_VERIFY',
      'Must fail'
    );
    perform pg_temp.ok('C02_IDENTIFIABLE_BLOCKED', false, 'No exception raised');
  exception when others then
    perform pg_temp.ok(
      'C02_IDENTIFIABLE_BLOCKED',
      sqlerrm like '%IDENTIFIABLE_CARE_DATA_NOT_ALLOWED%',
      sqlerrm
    );
  end;
end
$$;

reset role;

-- ACL separation: human users cannot invoke service ingestion, and service role
-- cannot invoke human mutation RPCs.
select pg_temp.ok(
  'C03_RPC_ACL_SEPARATION',
  not has_function_privilege(
    'authenticated',
    'public.register_care_case_v4(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.decide_care_case_v4(uuid,uuid,text,text,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'Service ingestion and human mutation ACLs are separated'
);

-- ---------------------------------------------------------------------------
-- Manager A: positive ACCEPT path and RLS isolation
-- ---------------------------------------------------------------------------
set role authenticated;
set "request.jwt.claim.sub" = '50000000-0000-4000-8000-000000000001';

select pg_temp.ok(
  'C04_RLS_ORG_A_VISIBLE',
  (select count(*) from public.care_queue_v4 where organization_id='10000000-0000-4000-8000-000000000001') = 3,
  'Manager A sees all three Org A care cases'
);

select pg_temp.ok(
  'C05_RLS_ORG_B_HIDDEN',
  (select count(*) from public.care_queue_v4 where organization_id='10000000-0000-4000-8000-000000000002') = 0,
  'Manager A cannot read Org B care case'
);

select public.decide_care_case_v4(
  '10000000-0000-4000-8000-000000000001',
  (select v::uuid from v4_014c_ctx where k='case_accept'),
  'ACCEPT',
  'VALID_FOLLOWUP',
  '40000000-0000-4000-8000-000000000001',
  now() + interval '2 hours'
);

select pg_temp.ok(
  'C06_ACCEPT_REQUIRES_ACCOUNTABILITY',
  (
    select human_decision='ACCEPT'
       and status='ACCEPTED'
       and owner_assigned
       and due_at is not null
    from public.care_queue_v4
    where item_id=(select v::uuid from v4_014c_ctx where k='case_accept')
  ),
  'ACCEPT produced Owner/SLA and accepted state'
);

do $$
begin
  begin
    perform public.verify_close_care_case_v4(
      '10000000-0000-4000-8000-000000000001',
      (select v::uuid from v4_014c_ctx where k='case_accept'),
      'RESOLVED',
      'EVIDENCE_REF',
      'EV-A-001'
    );
    perform pg_temp.ok('C07_VERIFY_BEFORE_ACTION_BLOCKED', false, 'No exception raised');
  exception when others then
    perform pg_temp.ok(
      'C07_VERIFY_BEFORE_ACTION_BLOCKED',
      sqlerrm like '%CARE_VERIFICATION_REQUIRES_ACTION%',
      sqlerrm
    );
  end;
end
$$;

select public.record_care_action_v4(
  '10000000-0000-4000-8000-000000000001',
  (select v::uuid from v4_014c_ctx where k='case_accept'),
  'CONTACT_ATTEMPT',
  'ACTION-A-001'
);

select public.verify_close_care_case_v4(
  '10000000-0000-4000-8000-000000000001',
  (select v::uuid from v4_014c_ctx where k='case_accept'),
  'RESOLVED',
  'EVIDENCE_REF',
  'EV-A-001'
);

select pg_temp.ok(
  'C08_ACCEPT_ACTION_VERIFY_CLOSE',
  (
    select human_decision='ACCEPT'
       and status='CLOSED'
       and first_action_at is not null
       and verified_at is not null
       and closed_at is not null
       and first_action_at <= verified_at
       and verified_at <= closed_at
    from private.care_cases_v4
    where id=(select v::uuid from v4_014c_ctx where k='case_accept')
  ),
  'ACCEPT path closed only after action and verification'
);

select pg_temp.ok(
  'C09_ACCEPT_EVIDENCE_TIMELINE',
  (
    select count(*) = 5
    from public.care_case_timeline_v4
    where case_id=(select v::uuid from v4_014c_ctx where k='case_accept')
      and event_type in (
        'CASE_CREATED','DECISION_ACCEPTED','ACTION_RECORDED','CASE_VERIFIED','CASE_CLOSED'
      )
  ),
  'Five expected append-only events exist'
);

-- ---------------------------------------------------------------------------
-- Manager A: REJECT path must not create a task.
-- ---------------------------------------------------------------------------
select public.decide_care_case_v4(
  '10000000-0000-4000-8000-000000000001',
  (select v::uuid from v4_014c_ctx where k='case_reject'),
  'REJECT',
  'NOT_APPROPRIATE',
  null,
  null
);

select pg_temp.ok(
  'C10_REJECT_NO_TASK',
  (
    select human_decision='REJECT'
       and status='REJECTED'
       and owner_membership_id is null
       and due_at is null
       and first_action_at is null
       and verified_at is null
       and closed_at is null
    from private.care_cases_v4
    where id=(select v::uuid from v4_014c_ctx where k='case_reject')
  )
  and not exists (
    select 1
    from private.care_case_verifications_v4
    where case_id=(select v::uuid from v4_014c_ctx where k='case_reject')
  ),
  'REJECT preserved decision evidence without task/action/verification'
);

do $$
begin
  begin
    perform public.record_care_action_v4(
      '10000000-0000-4000-8000-000000000001',
      (select v::uuid from v4_014c_ctx where k='case_reject'),
      'CONTACT_ATTEMPT',
      'SHOULD-NOT-EXIST'
    );
    perform pg_temp.ok('C11_REJECT_ACTION_BLOCKED', false, 'No exception raised');
  exception when others then
    perform pg_temp.ok(
      'C11_REJECT_ACTION_BLOCKED',
      sqlerrm like '%CARE_ACTION_REQUIRES_ACCEPT%',
      sqlerrm
    );
  end;
end
$$;

do $$
begin
  begin
    perform public.decide_care_case_v4(
      '10000000-0000-4000-8000-000000000001',
      (select v::uuid from v4_014c_ctx where k='case_pending'),
      'REJECT',
      'NOT_APPROPRIATE',
      '40000000-0000-4000-8000-000000000001',
      now() + interval '1 hour'
    );
    perform pg_temp.ok('C12_REJECT_OWNER_SLA_BLOCKED', false, 'No exception raised');
  exception when others then
    perform pg_temp.ok(
      'C12_REJECT_OWNER_SLA_BLOCKED',
      sqlerrm like '%REJECT_MUST_NOT_CREATE_OWNER_OR_SLA%',
      sqlerrm
    );
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Staff A: workflow.view only, no mutation.
-- ---------------------------------------------------------------------------
set role authenticated;
set "request.jwt.claim.sub" = '50000000-0000-4000-8000-000000000002';

select pg_temp.ok(
  'C13_READ_ONLY_STAFF_CAN_VIEW',
  (select count(*) from public.care_queue_v4 where organization_id='10000000-0000-4000-8000-000000000001') = 3,
  'Staff A retains scoped read access'
);

do $$
begin
  begin
    perform public.decide_care_case_v4(
      '10000000-0000-4000-8000-000000000001',
      (select v::uuid from v4_014c_ctx where k='case_pending'),
      'ACCEPT',
      'VALID_FOLLOWUP',
      '40000000-0000-4000-8000-000000000002',
      now() + interval '1 hour'
    );
    perform pg_temp.ok('C14_READ_ONLY_STAFF_MUTATION_BLOCKED', false, 'No exception raised');
  exception when others then
    perform pg_temp.ok(
      'C14_READ_ONLY_STAFF_MUTATION_BLOCKED',
      sqlerrm like '%WORKFLOW_MANAGE_PERMISSION_REQUIRED%',
      sqlerrm
    );
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Manager B: cross-tenant mutation must fail.
-- ---------------------------------------------------------------------------
set role authenticated;
set "request.jwt.claim.sub" = '50000000-0000-4000-8000-000000000003';

select pg_temp.ok(
  'C15_RLS_ORG_B_VISIBLE',
  (select count(*) from public.care_queue_v4 where organization_id='10000000-0000-4000-8000-000000000002') = 1,
  'Manager B sees Org B care case'
);

select pg_temp.ok(
  'C16_RLS_ORG_A_HIDDEN_FROM_B',
  (select count(*) from public.care_queue_v4 where organization_id='10000000-0000-4000-8000-000000000001') = 0,
  'Manager B cannot read Org A care cases'
);

do $$
begin
  begin
    perform public.decide_care_case_v4(
      '10000000-0000-4000-8000-000000000001',
      (select v::uuid from v4_014c_ctx where k='case_pending'),
      'ACCEPT',
      'VALID_FOLLOWUP',
      '40000000-0000-4000-8000-000000000003',
      now() + interval '1 hour'
    );
    perform pg_temp.ok('C17_CROSS_TENANT_MUTATION_BLOCKED', false, 'No exception raised');
  exception when others then
    perform pg_temp.ok(
      'C17_CROSS_TENANT_MUTATION_BLOCKED',
      sqlerrm like '%WORKFLOW_MANAGE_PERMISSION_REQUIRED%',
      sqlerrm
    );
  end;
end
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Database-level evidence and immutability.
-- ---------------------------------------------------------------------------
select pg_temp.ok(
  'C18_DIRECT_DML_REVOKED',
  not has_table_privilege('authenticated','private.care_cases_v4','INSERT')
  and not has_table_privilege('authenticated','private.care_cases_v4','UPDATE')
  and not has_table_privilege('authenticated','private.care_cases_v4','DELETE')
  and not has_table_privilege('service_role','private.care_cases_v4','INSERT'),
  'Care table mutation is RPC-only'
);

select pg_temp.ok(
  'C19_PUBLIC_RPC_INVOKER_ONLY',
  not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.proname in (
        'register_care_policy_v4','register_care_case_v4',
        'decide_care_case_v4','record_care_action_v4','verify_close_care_case_v4'
      )
      and p.prosecdef
  ),
  'No public care RPC is SECURITY DEFINER'
);

do $$
declare
  v_event_id bigint;
begin
  select min(id) into v_event_id from private.care_case_events_v4;
  begin
    update private.care_case_events_v4
    set payload = jsonb_build_object('tamper', true)
    where id = v_event_id;
    perform pg_temp.ok('C20_APPEND_ONLY_EVENT_IMMUTABLE', false, 'Update unexpectedly succeeded');
  exception when others then
    perform pg_temp.ok(
      'C20_APPEND_ONLY_EVENT_IMMUTABLE',
      sqlerrm like '%CARE_APPEND_ONLY_RECORD_IMMUTABLE%',
      sqlerrm
    );
  end;
end
$$;

select pg_temp.ok(
  'C21_AUDIT_TRACE_PRESENT',
  (select count(*) from public.audit_logs where source_type='CARE_COORDINATION_V4') >= 4,
  'Human decision/action/verification writes produced audit records'
);

select pg_temp.ok(
  'C22_PENDING_CASE_UNCHANGED_AFTER_NEGATIVE_TESTS',
  (
    select human_decision='PENDING'
       and status='PENDING_DECISION'
       and owner_membership_id is null
       and due_at is null
    from private.care_cases_v4
    where id=(select v::uuid from v4_014c_ctx where k='case_pending')
  ),
  'Failed unauthorized/invalid mutations left pending case unchanged'
);

do $$
begin
  if exists (select 1 from v4_014c_results where not pass) then
    raise exception 'V4_014C_ACCEPTANCE_FAILED: %',
      (select jsonb_agg(jsonb_build_object('test',test_id,'detail',detail) order by test_id)
       from v4_014c_results where not pass);
  end if;
end
$$;

select jsonb_build_object(
  'pass', count(*) filter (where pass),
  'fail', count(*) filter (where not pass),
  'total', count(*),
  'tests', jsonb_agg(
    jsonb_build_object('id',test_id,'pass',pass,'detail',detail)
    order by test_id
  )
) as v4_014c_acceptance
from v4_014c_results;
