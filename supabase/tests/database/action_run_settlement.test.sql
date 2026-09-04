begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '91000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'settlement-one@example.test', '', now(), now(), now()
);

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint
) values (
  '91100000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'email', 'settlement-item-1', now(), now(), repeat('c', 64)
);

insert into public.relay_events (
  id, user_id, source_item_id, kind, title, summary, confidence, provenance
) values
  (
    '91200000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    '91100000-0000-4000-8000-000000000001',
    'task', 'Settlement one', 'Synthetic settlement event', 1, '{}'
  ),
  (
    '91200000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000001',
    '91100000-0000-4000-8000-000000000001',
    'task', 'Settlement two', 'Synthetic settlement event', 1, '{}'
  );

insert into public.filter_rules (id, user_id, name, intent, plan) values (
  '91300000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  'Settlement', 'from gmail',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}'
);

insert into public.action_rules (
  id, user_id, filter_rule_id, provider, operation, input_template, approval_mode
) values (
  '91400000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000001',
  '91300000-0000-4000-8000-000000000001',
  'google-tasks', 'tasks.insert', '{}', 'required'
);

-- Two approved runs: one settled as a success, one exercised through the failure paths.
insert into public.action_runs (id, user_id, action_rule_id, event_id, provider, status, input)
values
  (
    public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001'
    ),
    '91000000-0000-4000-8000-000000000001',
    '91400000-0000-4000-8000-000000000001',
    '91200000-0000-4000-8000-000000000001',
    'google-tasks', 'approved', '{}'
  ),
  (
    public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002'
    ),
    '91000000-0000-4000-8000-000000000001',
    '91400000-0000-4000-8000-000000000001',
    '91200000-0000-4000-8000-000000000002',
    'google-tasks', 'approved', '{}'
  );

-- Completion ---------------------------------------------------------------------------------------

select lives_ok(
  format(
    $$select public.claim_action_run_for_workflow_v1(%L, %L, 'wf-settle-1')$$,
    '91000000-0000-4000-8000-000000000001',
    public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001'
    )
  ),
  'an approved run can be claimed for a workflow attempt'
);

select is(
  (
    select status from public.complete_action_run_v1(
      '91000000-0000-4000-8000-000000000001',
      public.relay_action_run_id(
        '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001'
      ),
      'wf-settle-1',
      'google-task-1'
    )
  ),
  'succeeded',
  'a running run settles as succeeded'
);

select is(
  (
    select provider_reference from public.action_runs
    where id = public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001'
    )
  ),
  'google-task-1',
  'the provider reference is recorded so a retry can recognise its own effect'
);

select isnt(
  (
    select completed_at from public.action_runs
    where id = public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001'
    )
  ),
  null,
  'a settled run carries a completion time'
);

-- A redelivered Workflow step reports the same effect and must converge, not raise.
select is(
  (
    select provider_reference from public.complete_action_run_v1(
      '91000000-0000-4000-8000-000000000001',
      public.relay_action_run_id(
        '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001'
      ),
      'wf-settle-1',
      'google-task-1'
    )
  ),
  'google-task-1',
  'a redelivered settlement converges on the recorded effect'
);

select throws_ok(
  format(
    $$select public.complete_action_run_v1(%L, %L, 'wf-settle-1', 'google-task-other')$$,
    '91000000-0000-4000-8000-000000000001',
    public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001'
    )
  ),
  '55006',
  null,
  'a second, different effect for one approval is refused rather than overwriting the first'
);

select throws_ok(
  format(
    $$select public.complete_action_run_v1(%L, %L, 'wf-other', 'google-task-1')$$,
    '91000000-0000-4000-8000-000000000001',
    public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001'
    )
  ),
  '55006',
  null,
  'a settlement from a workflow that never claimed the run is refused'
);

-- A committed effect is never undone by a later failure report.
select is(
  (
    select status from public.fail_action_run_v1(
      '91000000-0000-4000-8000-000000000001',
      public.relay_action_run_id(
        '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000001'
      ),
      'wf-settle-1',
      'unavailable',
      true
    )
  ),
  'succeeded',
  'a failure reported after a committed effect leaves the run succeeded'
);

select is(
  (
    select count(*)::int from public.audit_log
    where user_id = '91000000-0000-4000-8000-000000000001' and action = 'action.succeeded'
  ),
  1,
  'exactly one success is recorded in the audit trail despite the redelivery'
);

-- Failure ------------------------------------------------------------------------------------------

select lives_ok(
  format(
    $$select public.claim_action_run_for_workflow_v1(%L, %L, 'wf-settle-2')$$,
    '91000000-0000-4000-8000-000000000001',
    public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002'
    )
  ),
  'the second run is claimed for its first attempt'
);

select is(
  (
    select status from public.fail_action_run_v1(
      '91000000-0000-4000-8000-000000000001',
      public.relay_action_run_id(
        '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002'
      ),
      'wf-settle-2',
      'rate-limited',
      true
    )
  ),
  'approved',
  'a retryable failure returns the run to approved for a later attempt'
);

select is(
  (
    select workflow_instance_id from public.action_runs
    where id = public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002'
    )
  ),
  null,
  'a retryable failure clears the claim so the next attempt is not a conflict'
);

select is(
  (
    select attempt_count from public.action_runs
    where id = public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002'
    )
  ),
  1,
  'a retryable failure keeps the attempt already spent'
);

select lives_ok(
  format(
    $$select public.claim_action_run_for_workflow_v1(%L, %L, 'wf-settle-3')$$,
    '91000000-0000-4000-8000-000000000001',
    public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002'
    )
  ),
  'a returned run can be claimed again by a later attempt'
);

select is(
  (
    select status from public.fail_action_run_v1(
      '91000000-0000-4000-8000-000000000001',
      public.relay_action_run_id(
        '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002'
      ),
      'wf-settle-3',
      'grant-revoked',
      false
    )
  ),
  'failed',
  'a permanent failure ends the run'
);

select throws_ok(
  format(
    $$select public.fail_action_run_v1(%L, %L, 'wf-settle-3', 'Rate Limited', false)$$,
    '91000000-0000-4000-8000-000000000001',
    public.relay_action_run_id(
      '91400000-0000-4000-8000-000000000001', '91200000-0000-4000-8000-000000000002'
    )
  ),
  '22023',
  null,
  'an error code that is not lowercase and stable is refused'
);

select * from finish();
rollback;
