begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '80000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'disclosure-one@example.test', '', now(), now(), now()
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'disclosure-two@example.test', '', now(), now(), now()
  );

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint
) values
  (
    '80100000-0000-4000-8000-000000000001',
    '80000000-0000-4000-8000-000000000001',
    'email', 'synthetic-item-1', now(), now(), repeat('a', 64)
  ),
  (
    '80100000-0000-4000-8000-000000000002',
    '80000000-0000-4000-8000-000000000002',
    'email', 'synthetic-item-2', now(), now(), repeat('b', 64)
  );

insert into public.connections (
  id, user_id, provider, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce,
  encryption_environment
) values (
  '80200000-0000-4000-8000-000000000002',
  '80000000-0000-4000-8000-000000000002',
  'openai',
  decode('00', 'hex'), decode('01', 'hex'), decode('02', 'hex'), decode('03', 'hex'),
  'development'
);

-- A semantic revision for the second tenant, used to prove the RPC will not attach a disclosure to
-- another tenant's filter.
select public.create_filter_rule_revision(
  '80000000-0000-4000-8000-000000000002',
  'Urgent',
  'looks urgent',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"looks urgent","semantic":{"question":"Is this urgent?","minimumConfidence":0.8,"allowedFields":["subject"]}}',
  '[{"field":"subject","operators":["equals"]}]',
  '[{"text":"looks urgent","reason":"semantic-required"}]'
);

-- Recording a successful evaluation -------------------------------------------------------------

set local role service_role;

select lives_ok(
  $$select public.record_semantic_disclosure_v1(
    '80000000-0000-4000-8000-000000000001',
    '80100000-0000-4000-8000-000000000001',
    null,
    'gpt-4.1-mini',
    'filter-semantic-clause',
    'match',
    true,
    array['subject', 'body'],
    '[{"field":"body","kind":"email-address","count":2}]'::jsonb,
    'api.openai.com',
    0.940,
    'Invoice is due next week.',
    null
  )$$,
  'service role records a semantic disclosure through the RPC'
);

select results_eq(
  $$select provider, model, endpoint_host, purpose, decision, disclosed, disclosed_fields,
           confidence, rationale, failure_reason
    from public.ai_disclosures
    where user_id = '80000000-0000-4000-8000-000000000001'$$,
  $$values (
    'openai', 'gpt-4.1-mini', 'api.openai.com', 'filter-semantic-clause', 'match', true,
    array['subject', 'body'], 0.940::numeric(4,3), 'Invoice is due next week.', null::text
  )$$,
  'the disclosure records provider, model, endpoint, purpose, fields, confidence, and rationale'
);

select results_eq(
  $$select action, target_type,
           metadata ->> 'decision', metadata ->> 'disclosedFieldCount',
           metadata ->> 'redactionCount'
    from public.audit_log
    where user_id = '80000000-0000-4000-8000-000000000001'
      and action = 'filter.semantic_evaluated'$$,
  $$values ('filter.semantic_evaluated', 'ai_disclosure', 'match', '2', '1')$$,
  'the audit row carries counts and fixed values, not field content'
);

select lives_ok(
  $$select public.record_semantic_disclosure_v1(
    '80000000-0000-4000-8000-000000000001',
    '80100000-0000-4000-8000-000000000001',
    null,
    'gpt-4.1-mini',
    'filter-semantic-clause',
    'undecided',
    false,
    array[]::text[],
    '[]'::jsonb,
    null,
    null,
    null,
    'credential-revoked'
  )$$,
  'a failed attempt that sent nothing is recorded as undecided'
);

select throws_ok(
  $$select public.record_semantic_disclosure_v1(
    '80000000-0000-4000-8000-000000000001',
    '80100000-0000-4000-8000-000000000001',
    (select id from public.filter_rules where user_id = '80000000-0000-4000-8000-000000000002'),
    'gpt-4.1-mini',
    'filter-semantic-clause',
    'match',
    true,
    array['subject'],
    '[]'::jsonb,
    'api.openai.com'
  )$$,
  'P0002',
  null,
  'a disclosure cannot attach to another tenant''s filter revision'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields
    ) values (
      '80000000-0000-4000-8000-000000000001',
      '80100000-0000-4000-8000-000000000001',
      'direct-write', 'blocked', array['subject']
    )$$,
  '42501',
  null,
  'service role cannot write a disclosure outside the RPC'
);

reset role;

-- Constraints -----------------------------------------------------------------------------------

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, decision, failure_reason
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['subject'], 'match', 'rate-limited'
    )$$,
  '23514',
  null,
  'a provider failure cannot be recorded alongside a decision'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, decision, confidence,
      failure_reason
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['subject'], 'undecided', 0.9, 'timed-out'
    )$$,
  '23514',
  null,
  'a failed evaluation cannot carry a confidence'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, disclosed
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['subject'], false
    )$$,
  '23514',
  null,
  'an attempt that sent nothing cannot report disclosed fields'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['subject', 'raw_ciphertext']
    )$$,
  '23514',
  null,
  'a disclosure cannot name a field outside the filter field set'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, redactions
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['body'],
      '[{"field":"body","kind":"email-address","count":1,"value":"someone@example.test"}]'::jsonb
    )$$,
  '23514',
  null,
  'a redaction record cannot carry the value it removed'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, redactions
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['body'], '["email-address"]'::jsonb
    )$$,
  '23514',
  null,
  'a redaction record must be an object with field, kind, and count'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, decision
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['subject'], 'probably'
    )$$,
  '23514',
  null,
  'a disclosure decision must be one of the three known states'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, confidence
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['subject'], 1.5
    )$$,
  '23514',
  null,
  'confidence stays within zero and one'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, failure_reason
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['subject'], 'the api was sad'
    )$$,
  '23514',
  null,
  'a failure reason must be one of the fixed reasons'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, disclosed, endpoint_host
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['subject'], true, null
    )$$,
  '23514',
  null,
  'a disclosure that sent something must say where it went'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, disclosed, endpoint_host
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array[]::text[], false, 'api.openai.com'
    )$$,
  '23514',
  null,
  'an attempt that sent nothing cannot name a host it never contacted'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      user_id, source_item_id, model, purpose, disclosed_fields, disclosed, endpoint_host
    ) values (
      '80000000-0000-4000-8000-000000000001', '80100000-0000-4000-8000-000000000001',
      'm', 'p', array['subject'], true, 'https://api.openai.com/v1?key=secret'
    )$$,
  '23514',
  null,
  'only a bare host is recorded, never a URL that could carry a credential'
);

-- Immutability ----------------------------------------------------------------------------------

select throws_ok(
  $$update public.ai_disclosures set rationale = 'edited'
    where user_id = '80000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'a recorded disclosure cannot be edited afterwards'
);

select throws_ok(
  $$delete from public.ai_disclosures
    where user_id = '80000000-0000-4000-8000-000000000001'$$,
  '55000',
  null,
  'a recorded disclosure cannot be deleted afterwards'
);

select is(
  (select count(*)::bigint from public.ai_disclosures
   where user_id = '80000000-0000-4000-8000-000000000001'),
  2::bigint,
  'both recorded attempts survive, including the one that sent nothing'
);

-- Account deletion ------------------------------------------------------------------------------

delete from auth.users where id = '80000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::bigint from public.ai_disclosures
   where user_id = '80000000-0000-4000-8000-000000000001'),
  0::bigint,
  'removing the identity still cascades disclosures away despite immutability'
);

-- A disclosure attached to a filter revision is the case that also exercises the
-- `on delete set null (filter_rule_id)` referential action as a nested update.
set local role service_role;

select lives_ok(
  $$select public.record_semantic_disclosure_v1(
    '80000000-0000-4000-8000-000000000002',
    '80100000-0000-4000-8000-000000000002',
    (select id from public.filter_rules where user_id = '80000000-0000-4000-8000-000000000002'),
    'gpt-4.1-mini',
    'filter-semantic-clause',
    'no-match',
    true,
    array['subject'],
    '[]'::jsonb,
    'openrouter.ai',
    0.910,
    'Not time sensitive.',
    null
  )$$,
  'a disclosure can name the filter revision that caused it'
);

select results_eq(
  $$select endpoint_host from public.ai_disclosures
    where user_id = '80000000-0000-4000-8000-000000000002'$$,
  $$values ('openrouter.ai'::text)$$,
  'a disclosure sent elsewhere records the host it actually reached'
);

reset role;

delete from auth.users where id = '80000000-0000-4000-8000-000000000002';

select is(
  (select count(*)::bigint from public.ai_disclosures
   where user_id = '80000000-0000-4000-8000-000000000002'),
  0::bigint,
  'deletion cascades a filter-attached disclosure without tripping immutability'
);

select * from finish();
rollback;
