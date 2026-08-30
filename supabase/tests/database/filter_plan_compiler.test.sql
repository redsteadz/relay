begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '70000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'filter-one@example.test', '', now(), now(), now()
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'filter-two@example.test', '', now(), now(), now()
  );

insert into public.connections (
  id, user_id, provider, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce,
  encryption_environment
) values (
  '70100000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'openai',
  decode('00', 'hex'),
  decode('01', 'hex'),
  decode('02', 'hex'),
  decode('03', 'hex'),
  'development'
);

set local role service_role;

select lives_ok(
  $$select public.create_filter_rule_revision(
    '70000000-0000-4000-8000-000000000001',
    'Receipts',
    'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"}}',
    '[{"field":"source.kind","operators":["equals","in"]}]',
    '[]'
  )$$,
  'service role creates the first compiled revision'
);

select results_eq(
  $$select version, compiler_version, jsonb_array_length(unsupported_clauses)
    from public.filter_rules
    where user_id = '70000000-0000-4000-8000-000000000001'$$,
  $$values (1, 1, 0)$$,
  'compiled revision stores version and disclosure metadata'
);

select lives_ok(
  $$select public.create_filter_rule_revision(
    '70000000-0000-4000-8000-000000000001',
    'Urgent receipts',
    'from gmail and looks urgent',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail and looks urgent","deterministic":{"field":"source.kind","operator":"equals","value":"gmail"},"semantic":{"question":"Does this item look urgent?","minimumConfidence":0.8,"allowedFields":["subject","body"]}}',
    '[{"field":"source.kind","operators":["equals","in"]}]',
    '[{"text":"looks urgent","reason":"semantic-required"}]',
    true,
    (select series_id from public.filter_rules
      where user_id = '70000000-0000-4000-8000-000000000001' and version = 1),
    1
  )$$,
  'edit appends a second compiled revision'
);

select results_eq(
  $$select version, name from public.filter_rules
    where user_id = '70000000-0000-4000-8000-000000000001'
    order by version$$,
  $$values (1, 'Receipts'), (2, 'Urgent receipts')$$,
  'revision history preserves original content'
);

select throws_ok(
  $$select public.create_filter_rule_revision(
    '70000000-0000-4000-8000-000000000001',
    'Stale edit',
    'from gmail',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from gmail"}',
    '[]',
    '[]',
    true,
    (select series_id from public.filter_rules
      where user_id = '70000000-0000-4000-8000-000000000001' limit 1),
    1
  )$$,
  '23505',
  'Filter revision is stale: expected 1, current 2',
  'stale edits cannot allocate a competing revision'
);

select throws_ok(
  $$select public.create_filter_rule_revision(
    '70000000-0000-4000-8000-000000000001',
    'Unsafe plan',
    'send a webhook',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"send a webhook","provider":"webhook"}',
    '[]',
    '[{"text":"send a webhook","reason":"action-intent-not-allowed"}]'
  )$$,
  '22023',
  'Filter plans cannot select actions, providers, operations, endpoints, or credentials',
  'database rejects provider selection inside a plan'
);

select is(
  (public.revoke_openai_connection('70000000-0000-4000-8000-000000000001') ->> 'revoked'),
  'true',
  'service role atomically revokes the OpenAI credential'
);

select is(
  (select enabled from public.filter_rules
    where user_id = '70000000-0000-4000-8000-000000000001' and version = 2),
  false,
  'credential safety disable cannot leave the semantic revision active'
);

select is(
  (select count(*)::integer from public.connections
    where user_id = '70000000-0000-4000-8000-000000000001' and provider = 'openai'),
  0,
  'atomic revocation deletes the credential in the same transaction'
);

select lives_ok(
  $$select public.create_filter_rule_revision(
    '70000000-0000-4000-8000-000000000001',
    'Future semantic filter',
    'looks urgent',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"looks urgent","semantic":{"question":"Does this item look urgent?","minimumConfidence":0.8,"allowedFields":["subject"]}}',
    '[]',
    '[{"text":"looks urgent","reason":"semantic-required"}]'
  )$$,
  'semantic compilation still persists after credential revocation'
);

select is(
  (select enabled from public.filter_rules where name = 'Future semantic filter'),
  false,
  'semantic revision created without an active credential is disabled'
);

select throws_ok(
  $$insert into public.filter_rules (user_id, name, intent, plan)
    values (
      '70000000-0000-4000-8000-000000000001',
      'Service bypass',
      'from sms',
      '{"schemaVersion":1,"compilerVersion":1,"intent":"from sms"}'
    )$$,
  '42501',
  null,
  'service role cannot bypass the revision RPC with a direct insert'
);

insert into public.connections (
  id, user_id, provider, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce,
  encryption_environment
) values (
  '70200000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'openai',
  decode('10', 'hex'),
  decode('11', 'hex'),
  decode('12', 'hex'),
  decode('13', 'hex'),
  'development'
);

reset role;

select throws_ok(
  $$update public.filter_rules set name = 'Overwritten' where version = 1$$,
  '55000',
  'Filter revisions are immutable; create a new revision',
  'even a privileged direct update cannot overwrite a revision'
);

select throws_ok(
  $$delete from public.filter_rules where version = 1$$,
  '55000',
  'Filter revisions are immutable; create a new revision',
  'even a privileged direct delete cannot erase a revision'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$select count(*)::bigint from public.filter_rules$$,
  $$values (3::bigint)$$,
  'tenant sees every revision in its own series'
);

select throws_ok(
  $$insert into public.filter_rules (user_id, series_id, name, intent, plan)
    values (
      '70000000-0000-4000-8000-000000000001',
      gen_random_uuid(),
      'Direct write',
      'from sms',
      '{"schemaVersion":1,"compilerVersion":1,"intent":"from sms"}'
    )$$,
  '42501',
  null,
  'tenant cannot bypass compiler persistence with a direct insert'
);

select throws_ok(
  $$update public.filter_rules set name = 'Direct edit'$$,
  '42501',
  null,
  'tenant cannot directly update compiled revisions'
);

select throws_ok(
  $$delete from public.filter_rules$$,
  '42501',
  null,
  'tenant cannot directly delete compiled revisions'
);

select results_eq(
  $$with removed as (
      delete from public.connections where provider = 'openai' returning 1
    )
    select count(*)::bigint from removed$$,
  $$values (0::bigint)$$,
  'tenant cannot bypass atomic OpenAI revocation with a direct connection delete'
);

select throws_ok(
  $$select public.create_filter_rule_revision(
    '70000000-0000-4000-8000-000000000001',
    'Direct RPC',
    'from sms',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from sms"}',
    '[]',
    '[]'
  )$$,
  '42501',
  null,
  'tenant cannot invoke service-only revision RPC'
);

select throws_ok(
  $$select public.revoke_openai_connection('70000000-0000-4000-8000-000000000001')$$,
  '42501',
  null,
  'tenant cannot invoke service-only credential revocation RPC'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select results_eq(
  $$select count(*)::bigint from public.filter_rules$$,
  $$values (0::bigint)$$,
  'second tenant cannot read first tenant revision history'
);

reset role;

select results_eq(
  $$select count(*)::bigint from public.audit_log
    where user_id = '70000000-0000-4000-8000-000000000001'
      and action = 'filter.revision_compiled'$$,
  $$values (3::bigint)$$,
  'each compiled revision has an audit record'
);

select is(
  (select count(distinct series_id)::integer from public.filter_rules
    where user_id = '70000000-0000-4000-8000-000000000001'),
  2,
  'edits retain stable series id while new filters receive a new series'
);

select results_eq(
  $$select count(*)::bigint from public.audit_log
    where user_id = '70000000-0000-4000-8000-000000000001'
      and action = 'connector.revoked'$$,
  $$values (1::bigint)$$,
  'atomic credential revocation records its audit event'
);

select * from finish();
rollback;
