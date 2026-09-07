begin;

create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '90000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'ledger-one@example.test', '', now(), now(), now()
  ),
  (
    '90000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'ledger-two@example.test', '', now(), now(), now()
  );

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint
) values
  (
    '90100000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'email', 'ledger-item-1', now(), now(), repeat('a', 64)
  ),
  (
    '90100000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000002',
    'email', 'ledger-item-2', now(), now(), repeat('b', 64)
  );

insert into public.relay_events (
  id, user_id, source_item_id, kind, title, summary, confidence, provenance
) values
  (
    '90200000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    '90100000-0000-4000-8000-000000000001',
    'task', 'Synthetic one', 'Synthetic ledger event', 1, '{}'
  ),
  (
    '90200000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000002',
    '90100000-0000-4000-8000-000000000002',
    'task', 'Synthetic two', 'Synthetic ledger event', 1, '{}'
  );

insert into public.filter_rules (id, user_id, name, intent, plan) values
  (
    '90300000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    'Ledger one', 'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}'
  ),
  (
    '90300000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000002',
    'Ledger two', 'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}'
  );

insert into public.action_rules (
  id, user_id, filter_rule_id, provider, operation, input_template, approval_mode
) values
  (
    '90400000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000001',
    'google-tasks', 'tasks.insert', '{}', 'required'
  ),
  (
    '90400000-0000-4000-8000-0000000000a1',
    '90000000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000001',
    'nextcloud-budget', 'transactions.create', '{}', 'automatic'
  ),
  (
    '90400000-0000-4000-8000-0000000000b1',
    '90000000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000001',
    'webhook', 'deliver', '{}', 'required'
  ),
  (
    '90400000-0000-4000-8000-000000000002',
    '90000000-0000-4000-8000-000000000002',
    '90300000-0000-4000-8000-000000000002',
    'google-tasks', 'tasks.insert', '{}', 'required'
  );

-- Disabled from the start: proving a disabled rule cannot propose needs no state change.
update public.action_rules set enabled = false
where id = '90400000-0000-4000-8000-0000000000b1';

-- Deterministic identity --------------------------------------------------------------------------

select is(
  public.relay_action_run_id(
    '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
  ),
  public.relay_action_run_id(
    '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
  ),
  'action identity is stable for one rule and event pair'
);

select isnt(
  public.relay_action_run_id(
    '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
  ),
  public.relay_action_run_id(
    '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000002'
  ),
  'a different event yields a different action identity'
);

select isnt(
  public.relay_action_run_id(
    '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
  ),
  public.relay_action_run_id(
    '90400000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-000000000001'
  ),
  'a different rule yields a different action identity'
);

-- Matches the RFC 4122 UUIDv5 computed independently in `packages/domain`, so the two derivations
-- cannot silently diverge.
select is(
  public.relay_action_run_id(
    '14000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001'
  ),
  '902e9213-0117-5bfd-829a-c4daa0000772'::uuid,
  'action identity matches the independently computed UUIDv5 vector'
);

select is(
  substring(
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
    )::text from 15 for 1
  ),
  '5',
  'action identity is a version 5 UUID'
);

-- Proposal ----------------------------------------------------------------------------------------

set local role service_role;

select lives_ok(
  $$select public.propose_action_run_v1(
    '90000000-0000-4000-8000-000000000001',
    '90400000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001',
    '{"title":"Synthetic task"}'::jsonb
  )$$,
  'service role proposes an action run from an enabled owned rule'
);

select results_eq(
  $$select id, provider, status::text, approval_mode, approved_at is null
    from public.action_runs
    where user_id = '90000000-0000-4000-8000-000000000001'$$,
  $$values (
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
    ),
    'google-tasks'::public.action_provider,
    'awaiting-approval',
    'required',
    true
  )$$,
  'the run derives its id and takes provider and approval mode from the rule'
);

select results_eq(
  $$select metadata ->> 'provider', metadata ->> 'approvalMode', metadata ->> 'status'
    from public.audit_log
    where user_id = '90000000-0000-4000-8000-000000000001' and action = 'action.proposed'$$,
  $$values ('google-tasks', 'required', 'awaiting-approval')$$,
  'proposal writes one metadata-only audit record'
);

-- Idempotency: a redelivered message must converge, not duplicate.
select lives_ok(
  $$select public.propose_action_run_v1(
    '90000000-0000-4000-8000-000000000001',
    '90400000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001',
    '{"title":"Synthetic task"}'::jsonb
  )$$,
  'a repeated proposal for the same rule and event succeeds'
);

select is(
  (select count(*)::bigint from public.action_runs
   where user_id = '90000000-0000-4000-8000-000000000001'),
  1::bigint,
  'the repeated proposal converged on one run rather than creating a second'
);

select is(
  (select count(*)::bigint from public.audit_log
   where user_id = '90000000-0000-4000-8000-000000000001' and action = 'action.proposed'),
  1::bigint,
  'the repeated proposal did not duplicate the audit record'
);

select lives_ok(
  $$select public.propose_action_run_v1(
    '90000000-0000-4000-8000-000000000001',
    '90400000-0000-4000-8000-0000000000a1',
    '90200000-0000-4000-8000-000000000001',
    '{}'::jsonb
  )$$,
  'an automatic rule proposes without waiting for approval'
);

select results_eq(
  $$select status::text, approval_mode, approved_at is not null
    from public.action_runs
    where action_rule_id = '90400000-0000-4000-8000-0000000000a1'$$,
  $$values ('approved', 'automatic', true)$$,
  'automatic approval is read from the rule and timestamped'
);

select throws_ok(
  $$select public.propose_action_run_v1(
    '90000000-0000-4000-8000-000000000001',
    '90400000-0000-4000-8000-0000000000b1',
    '90200000-0000-4000-8000-000000000001',
    '{}'::jsonb
  )$$,
  'P0002',
  null,
  'a disabled rule cannot propose an action'
);

-- Cross-tenant binding ----------------------------------------------------------------------------

select throws_ok(
  $$select public.propose_action_run_v1(
    '90000000-0000-4000-8000-000000000001',
    '90400000-0000-4000-8000-000000000002',
    '90200000-0000-4000-8000-000000000001',
    '{}'::jsonb
  )$$,
  'P0002',
  null,
  'a tenant cannot propose against another tenant''s action rule'
);

select throws_ok(
  $$select public.propose_action_run_v1(
    '90000000-0000-4000-8000-000000000001',
    '90400000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000002',
    '{}'::jsonb
  )$$,
  'P0002',
  null,
  'a tenant cannot propose against another tenant''s event'
);

select throws_ok(
  $$select public.propose_action_run_v1(
    '90000000-0000-4000-8000-000000000001',
    '90400000-0000-4000-8000-000000000001',
    '90200000-0000-4000-8000-000000000001',
    '{"provider":"webhook","endpoint":"https://attacker.example.test"}'::jsonb
  )$$,
  '22023',
  null,
  'action input cannot smuggle a provider or endpoint'
);

reset role;

-- Schema invariants -------------------------------------------------------------------------------

select throws_ok(
  $$insert into public.action_runs (
      id, user_id, action_rule_id, event_id, provider, input
    ) values (
      '90900000-0000-4000-8000-000000000009',
      '90000000-0000-4000-8000-000000000001',
      '90400000-0000-4000-8000-000000000001',
      '90200000-0000-4000-8000-000000000001',
      'google-tasks', '{}'
    )$$,
  '23514',
  null,
  'an action run cannot be written with an identity it did not derive'
);

select throws_ok(
  $$insert into public.action_runs (
      id, user_id, action_rule_id, event_id, provider, input
    ) values (
      public.relay_action_run_id(
        '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000002'
      ),
      '90000000-0000-4000-8000-000000000001',
      '90400000-0000-4000-8000-000000000001',
      '90200000-0000-4000-8000-000000000002',
      'google-tasks', '{}'
    )$$,
  '23503',
  null,
  'a composite tenant key blocks binding a run to another tenant''s event'
);

select throws_ok(
  $$insert into public.action_runs (
      id, user_id, action_rule_id, event_id, provider, input
    ) values (
      public.relay_action_run_id(
        '90400000-0000-4000-8000-0000000000b1', '90200000-0000-4000-8000-000000000001'
      ),
      '90000000-0000-4000-8000-000000000001',
      '90400000-0000-4000-8000-0000000000b1',
      '90200000-0000-4000-8000-000000000001',
      'google-tasks', '{}'
    )$$,
  '23503',
  null,
  'a run cannot claim a provider its rule does not have'
);

select throws_ok(
  $$update public.action_runs
    set approved_at = now()
    where action_rule_id = '90400000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'a run still awaiting a decision cannot carry an approval time'
);

-- Approval --------------------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  format(
    $$select public.decide_action_run(%L, 'approve')$$,
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
    )
  ),
  'P0002',
  null,
  'a second tenant cannot approve the first tenant''s action run'
);

select is(
  (select count(*)::bigint from public.action_runs),
  0::bigint,
  'a second tenant cannot even see the first tenant''s action runs'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $$insert into public.action_runs (
      id, user_id, action_rule_id, event_id, provider, input
    ) values (
      public.relay_action_run_id(
        '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000002'
      ),
      '90000000-0000-4000-8000-000000000001',
      '90400000-0000-4000-8000-000000000001',
      '90200000-0000-4000-8000-000000000002',
      'google-tasks', '{}'
    )$$,
  '42501',
  null,
  'an authenticated client cannot write the ledger outside the routine'
);

select results_eq(
  format(
    $$select status::text, approved_at is not null from public.decide_action_run(%L, 'approve')$$,
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
    )
  ),
  $$values ('approved', true)$$,
  'the owning tenant approves its own awaiting run'
);

select results_eq(
  $$select metadata ->> 'fromStatus', metadata ->> 'toStatus'
    from public.audit_log
    where user_id = '90000000-0000-4000-8000-000000000001' and action = 'action.approved'$$,
  $$values ('awaiting-approval', 'approved')$$,
  'the decision records the transition it performed'
);

-- Concurrency: the second decision observes committed state, so it cannot re-approve.
select throws_ok(
  format(
    $$select public.decide_action_run(%L, 'approve')$$,
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
    )
  ),
  'P0002',
  null,
  'a repeated approval of an already-approved run is refused'
);

select throws_ok(
  format($$select public.decide_action_run(%L, 'sabotage')$$, gen_random_uuid()),
  '22023',
  null,
  'only approve and cancel are accepted decisions'
);

reset role;

-- Workflow eligibility ----------------------------------------------------------------------------

-- The automatic rule's run is already approved. Disabling the rule afterwards is the case that
-- matters: an approval can predate a rule being turned off, and the claim has to re-check.
update public.action_rules set enabled = false
where id = '90400000-0000-4000-8000-0000000000a1';

set local role service_role;

select throws_ok(
  format(
    $$select public.claim_action_run_for_workflow_v1(
      '90000000-0000-4000-8000-000000000001', %L, 'workflow-a'
    )$$,
    public.relay_action_run_id(
      '90400000-0000-4000-8000-0000000000a1', '90200000-0000-4000-8000-000000000001'
    )
  ),
  'P0002',
  null,
  'a claim is refused when the rule was disabled after approval'
);

select results_eq(
  format(
    $$select status::text, attempt_count, workflow_instance_id
      from public.claim_action_run_for_workflow_v1(
        '90000000-0000-4000-8000-000000000001', %L, 'workflow-a'
      )$$,
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
    )
  ),
  $$values ('running', 1, 'workflow-a')$$,
  'an approved run is claimed once for a workflow attempt'
);

select results_eq(
  format(
    $$select status::text, attempt_count
      from public.claim_action_run_for_workflow_v1(
        '90000000-0000-4000-8000-000000000001', %L, 'workflow-a'
      )$$,
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
    )
  ),
  $$values ('running', 1)$$,
  'the same workflow repeating a lost claim does not start a second attempt'
);

select throws_ok(
  format(
    $$select public.claim_action_run_for_workflow_v1(
      '90000000-0000-4000-8000-000000000001', %L, 'workflow-b'
    )$$,
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
    )
  ),
  '55006',
  null,
  'a second workflow cannot claim a run that is already running'
);

reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  format(
    $$select public.decide_action_run(%L, 'cancel')$$,
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000001', '90200000-0000-4000-8000-000000000001'
    )
  ),
  'P0002',
  null,
  'a running action can no longer be cancelled'
);

reset role;

-- Server classification gating (issue #171, ADR-0014) ------------------------------------------------
insert into public.categories (id, user_id, name) values
  ('90500000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'Finance');

insert into public.filter_rules (id, user_id, name, intent, plan, category_id) values
  (
    '90300000-0000-4000-8000-000000000099',
    '90000000-0000-4000-8000-000000000001',
    'Finance Rule', 'finance receipts',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"finance receipts","deterministic":{"field":"category","operator":"equals","value":"Finance"}}',
    '90500000-0000-4000-8000-000000000001'
  );

insert into public.action_rules (
  id, user_id, filter_rule_id, provider, operation, input_template, approval_mode
) values
  (
    '90400000-0000-4000-8000-000000000099',
    '90000000-0000-4000-8000-000000000001',
    '90300000-0000-4000-8000-000000000099',
    'google-tasks', 'tasks.insert', '{}', 'required'
  );

select throws_ok(
  $$select public.propose_action_run_v1(
    '90000000-0000-4000-8000-000000000001',
    '90400000-0000-4000-8000-000000000099',
    '90200000-0000-4000-8000-000000000001',
    '{}'::jsonb
  )$$,
  'P0002',
  null,
  'category-gated proposal is refused when no classification exists'
);

insert into public.classifications (
  id, user_id, source_item_id, category_id, method, confidence, origin
) values (
  '90600000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '90100000-0000-4000-8000-000000000001',
  '90500000-0000-4000-8000-000000000001',
  'deterministic',
  1,
  'device'
);

select throws_ok(
  $$select public.propose_action_run_v1(
    '90000000-0000-4000-8000-000000000001',
    '90400000-0000-4000-8000-000000000099',
    '90200000-0000-4000-8000-000000000001',
    '{}'::jsonb
  )$$,
  'P0002',
  null,
  'category-gated proposal is refused when classification was authored by device'
);

update public.classifications
set origin = 'server'
where id = '90600000-0000-4000-8000-000000000001';

select results_eq(
  $$select status::text
    from public.propose_action_run_v1(
      '90000000-0000-4000-8000-000000000001',
      '90400000-0000-4000-8000-000000000099',
      '90200000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )$$,
  $$values ('awaiting-approval')$$,
  'category-gated proposal succeeds when server classification exists'
);

set local role authenticated;
select public.decide_action_run(
  public.relay_action_run_id(
    '90400000-0000-4000-8000-000000000099', '90200000-0000-4000-8000-000000000001'
  ),
  'approve'
);
reset role;

select results_eq(
  format(
    $$select status::text
      from public.claim_action_run_for_workflow_v1(
        '90000000-0000-4000-8000-000000000001', %L, 'workflow-cat-1'
      )$$,
    public.relay_action_run_id(
      '90400000-0000-4000-8000-000000000099', '90200000-0000-4000-8000-000000000001'
    )
  ),
  $$values ('running')$$,
  'category-gated workflow claim succeeds with server classification'
);

select * from finish();
rollback;
