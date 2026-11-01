begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '71000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'creation-key-one@example.test', '', now(), now(), now()
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'creation-key-two@example.test', '', now(), now(), now()
  );

set local role service_role;

-- The save that committed, whose reply never reached the app.
select lives_ok(
  $$select public.create_filter_rule_revision(
    '71000000-0000-4000-8000-000000000001',
    'Receipts',
    'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}',
    '[{"field":"source.kind","operators":["equals","in"]}]',
    '[]',
    p_creation_key => '71200000-0000-4000-8000-000000000001'
  )$$,
  'a new rule is created with its creation key'
);

-- The app's retry of that same save.
select is(
  (select (public.create_filter_rule_revision(
    '71000000-0000-4000-8000-000000000001',
    'Receipts',
    'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}',
    '[{"field":"source.kind","operators":["equals","in"]}]',
    '[]',
    p_creation_key => '71200000-0000-4000-8000-000000000001'
  )).id),
  (select id from public.filter_rules
    where user_id = '71000000-0000-4000-8000-000000000001' and version = 1),
  'a retry with the same key returns the stored revision'
);

select results_eq(
  $$select count(*)::integer, count(distinct series_id)::integer from public.filter_rules
    where user_id = '71000000-0000-4000-8000-000000000001'$$,
  $$values (1, 1)$$,
  'a retried save leaves one rule, not two'
);

select results_eq(
  $$select count(*)::integer from public.audit_log
    where user_id = '71000000-0000-4000-8000-000000000001'
      and action = 'filter.revision_compiled'$$,
  $$values (1)$$,
  'a retry records no second compilation'
);

select throws_ok(
  $$select public.create_filter_rule_revision(
    '71000000-0000-4000-8000-000000000001',
    'Receipts',
    'from sms',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from sms","deterministic":{"field":"source.kind","operator":"equals","value":"sms"}}',
    '[{"field":"source.kind","operators":["equals","in"]}]',
    '[]',
    p_creation_key => '71200000-0000-4000-8000-000000000001'
  )$$,
  '23505',
  'Filter creation key was already used for a different rule',
  'a reused key with a different intent is a conflict'
);

select throws_ok(
  $$select public.create_filter_rule_revision(
    '71000000-0000-4000-8000-000000000001',
    'Receipts',
    'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}',
    '[{"field":"source.kind","operators":["equals","in"]}]',
    '[]',
    false,
    p_creation_key => '71200000-0000-4000-8000-000000000001'
  )$$,
  '23505',
  'Filter creation key was already used for a different rule',
  'a reused key asking for a paused rule is a conflict'
);

select results_eq(
  $$select count(*)::integer from public.filter_rules
    where user_id = '71000000-0000-4000-8000-000000000001'$$,
  $$values (1)$$,
  'a refused retry stores nothing'
);

select throws_ok(
  $$select public.create_filter_rule_revision(
    '71000000-0000-4000-8000-000000000001',
    'Receipts',
    'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}',
    '[{"field":"source.kind","operators":["equals","in"]}]',
    '[]',
    true,
    (select series_id from public.filter_rules
      where user_id = '71000000-0000-4000-8000-000000000001' and version = 1),
    1,
    null,
    '71200000-0000-4000-8000-000000000002'
  )$$,
  '22023',
  'Only a new filter series takes a creation key',
  'an edit cannot carry a creation key'
);

-- Keys are scoped to a tenant, so one person's key never answers with another person's rule.
select lives_ok(
  $$select public.create_filter_rule_revision(
    '71000000-0000-4000-8000-000000000002',
    'Receipts',
    'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}',
    '[{"field":"source.kind","operators":["equals","in"]}]',
    '[]',
    p_creation_key => '71200000-0000-4000-8000-000000000001'
  )$$,
  'another tenant can use the same key value'
);

select results_eq(
  $$select count(*)::integer from public.filter_rules
    where user_id = '71000000-0000-4000-8000-000000000002'$$,
  $$values (1)$$,
  'the other tenant gets its own rule'
);

-- The rule is edited after the lost reply; a late retry still answers with what it created.
select lives_ok(
  $$select public.create_filter_rule_revision(
    '71000000-0000-4000-8000-000000000001',
    'Bank receipts',
    'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}',
    '[{"field":"source.kind","operators":["equals","in"]}]',
    '[]',
    true,
    (select series_id from public.filter_rules
      where user_id = '71000000-0000-4000-8000-000000000001' and version = 1),
    1
  )$$,
  'the created rule can be edited'
);

select results_eq(
  $$select (public.create_filter_rule_revision(
      '71000000-0000-4000-8000-000000000001',
      'Receipts',
      'from gmail',
      '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}',
      '[{"field":"source.kind","operators":["equals","in"]}]',
      '[]',
      p_creation_key => '71200000-0000-4000-8000-000000000001'
    )).version,
    (select count(*)::integer from public.filter_rules
      where user_id = '71000000-0000-4000-8000-000000000001')$$,
  $$values (1, 2)$$,
  'a late retry returns the first revision and adds nothing after an edit'
);

select * from finish();
rollback;
