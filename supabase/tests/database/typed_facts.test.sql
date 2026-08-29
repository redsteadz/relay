begin;

create extension if not exists pgtap with schema extensions;
select plan(43);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '51000000-0000-4000-8000-000000000021',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'facts-one@example.test', '', now(), now(), now()
  ),
  (
    '52000000-0000-4000-8000-000000000021',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'facts-two@example.test', '', now(), now(), now()
  );

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint,
  fact_set_fingerprint
) values
  (
    '51100000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'gmail', 'synthetic-fact-source-one', now(), now(), repeat('1', 64), repeat('a', 64)
  ),
  (
    '52200000-0000-4000-8000-000000000021',
    '52000000-0000-4000-8000-000000000021',
    'sms', 'synthetic-fact-source-two', now(), now(), repeat('2', 64), repeat('b', 64)
  ),
  (
    '51300000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'email', 'synthetic-pre-migration-source', now(), now(), repeat('3', 64), null
  ),
  (
    'abcdefab-cdef-4abc-8def-abcdefabcdef',
    '51000000-0000-4000-8000-000000000021',
    'notification', 'synthetic-uppercase-fact-source', now(), now(), repeat('7', 64), repeat('7', 64)
  );

select is(
  public.persist_encrypted_source_item_v3(
    '51400000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'notification', null, 'synthetic-v3-source', null, now(), now(),
    repeat('4', 64), repeat('c', 64), now(), now() + interval '7 days', 'development',
    decode(repeat('41', 16), 'hex'), decode(repeat('42', 12), 'hex'),
    decode(repeat('43', 48), 'hex'), decode(repeat('44', 12), 'hex'), 1
  ),
  'stored',
  'v3 atomically stores source and fact-set fingerprint'
);

select is(
  (select fact_set_fingerprint from public.source_items
   where id = '51400000-0000-4000-8000-000000000021'),
  repeat('c', 64),
  'v3 source row retains exact fact-set fingerprint'
);

select is(
  public.persist_encrypted_source_item_v3(
    '51400000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'notification', null, 'synthetic-v3-source', null, now(), now(),
    repeat('4', 64), repeat('c', 64), now(), now() + interval '7 days', 'development',
    decode(repeat('51', 16), 'hex'), decode(repeat('52', 12), 'hex'),
    decode(repeat('53', 48), 'hex'), decode(repeat('54', 12), 'hex'), 1
  ),
  'duplicate',
  'v3 same-ID retry with exact fact digest is duplicate'
);

select is(
  public.persist_encrypted_source_item_v3(
    '51400000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'notification', null, 'synthetic-v3-source', null, now(), now(),
    repeat('5', 64), repeat('c', 64), now(), now() + interval '7 days', 'development',
    decode(repeat('51', 16), 'hex'), decode(repeat('52', 12), 'hex'),
    decode(repeat('53', 48), 'hex'), decode(repeat('54', 12), 'hex'), 1
  ),
  'fact-integrity-conflict',
  'v3 same-ID retry with changed content and exact fact digest fails closed'
);

select is(
  public.persist_encrypted_source_item_v3(
    '51400000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'notification', null, 'synthetic-v3-source', null, now(), now(),
    repeat('4', 64), repeat('d', 64), now(), now() + interval '7 days', 'development',
    decode(repeat('61', 16), 'hex'), decode(repeat('62', 12), 'hex'),
    decode(repeat('63', 48), 'hex'), decode(repeat('64', 12), 'hex'), 1
  ),
  'fact-integrity-conflict',
  'v3 same-ID retry with changed fact digest fails closed'
);

select is(
  public.persist_encrypted_source_item_v3(
    '51500000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'notification', null, 'synthetic-v3-source', null, now(), now(),
    repeat('5', 64), repeat('e', 64), now(), now() + interval '7 days', 'development',
    decode(repeat('71', 16), 'hex'), decode(repeat('72', 12), 'hex'),
    decode(repeat('73', 48), 'hex'), decode(repeat('74', 12), 'hex'), 1
  ),
  'duplicate',
  'v3 source-identity duplicate under another ID remains normal dedupe'
);

select is(
  public.persist_encrypted_source_item_v3(
    '51600000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'notification', null, 'synthetic-v3-content-copy', null, now(), now(),
    repeat('4', 64), repeat('f', 64), now(), now() + interval '7 days', 'development',
    decode(repeat('75', 16), 'hex'), decode(repeat('76', 12), 'hex'),
    decode(repeat('77', 48), 'hex'), decode(repeat('78', 12), 'hex'), 1
  ),
  'duplicate',
  'v3 content duplicate under another ID remains normal dedupe'
);

select is(
  public.persist_encrypted_source_item_v3(
    '52200000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'sms', null, 'synthetic-cross-tenant', null, now(), now(),
    repeat('6', 64), repeat('f', 64), now(), now() + interval '7 days', 'development',
    decode(repeat('81', 16), 'hex'), decode(repeat('82', 12), 'hex'),
    decode(repeat('83', 48), 'hex'), decode(repeat('84', 12), 'hex'), 1
  ),
  'tenant-conflict',
  'v3 cross-tenant source ID conflict returns fixed result'
);

select is(
  public.persist_encrypted_source_item_v3(
    '51300000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    'email', null, 'synthetic-pre-migration-source', null, now(), now(),
    repeat('3', 64), repeat('a', 64), now(), now() + interval '7 days', 'development',
    decode(repeat('91', 16), 'hex'), decode(repeat('92', 12), 'hex'),
    decode(repeat('93', 48), 'hex'), decode(repeat('94', 12), 'hex'), 1
  ),
  'fact-integrity-conflict',
  'v3 pre-migration same-ID row with null fact digest fails closed'
);

select is(
  public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    'abcdefab-cdef-4abc-8def-abcdefabcdef',
    repeat('7', 64),
    1,
    '[{
      "sourceItemId":"ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF",
      "normalizerVersion":1,"ordinal":0,"kind":"currency","certainty":"certain",
      "value":"USD","provenance":[{"field":"attributes.currency"}]
    }]'::jsonb
  ),
  'stored',
  'fact persistence compares valid uppercase nested source UUID semantically'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    'abcdefab-cdef-4abc-8def-abcdefabcdef',
    repeat('7', 64),
    2,
    '[{
      "sourceItemId":"not-a-uuid",
      "normalizerVersion":2,"ordinal":0,"kind":"currency","certainty":"certain",
      "value":"USD","provenance":[{"field":"attributes.currency"}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source fact set',
  'fact persistence still rejects malformed nested source UUIDs'
);

select is(
  public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021',
    repeat('a', 64),
    1,
    '[
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":1,
        "ordinal":0,
        "kind":"amount",
        "certainty":"certain",
        "value":"12345678901234567890.001200",
        "provenance":[{"field":"attributes.amount"}]
      },
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":1,
        "ordinal":1,
        "kind":"currency",
        "certainty":"certain",
        "value":"USD",
        "provenance":[{"field":"attributes.currency"}]
      },
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":1,
        "ordinal":2,
        "kind":"merchant",
        "certainty":"uncertain",
        "uncertaintyReason":"contradictory",
        "provenance":[{"field":"attributes.merchant[0]"},{"field":"attributes.merchant[1]"}]
      }
    ]'::jsonb
  ),
  'stored',
  'first normalized fact set is stored'
);

select is(
  public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021',
    repeat('a', 64),
    1,
    '[
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":1,"ordinal":0,"kind":"amount","certainty":"certain",
        "value":"12345678901234567890.001200",
        "provenance":[{"field":"attributes.amount"}]
      },
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":1,"ordinal":1,"kind":"currency","certainty":"certain",
        "value":"USD","provenance":[{"field":"attributes.currency"}]
      },
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":1,"ordinal":2,"kind":"merchant","certainty":"uncertain",
        "uncertaintyReason":"contradictory",
        "provenance":[{"field":"attributes.merchant[0]"},{"field":"attributes.merchant[1]"}]
      }
    ]'::jsonb
  ),
  'duplicate',
  'exact retry is idempotent'
);

select is(
  (select value #>> '{}' from public.source_facts
   where source_item_id = '51100000-0000-4000-8000-000000000021' and kind = 'amount'),
  '12345678901234567890.001200',
  'money remains an exact decimal string'
);

select ok(
  (select value is null and uncertainty_reason = 'contradictory'
   from public.source_facts
   where source_item_id = '51100000-0000-4000-8000-000000000021' and kind = 'merchant'),
  'contradictory extraction stores uncertainty without candidate content'
);

select is(
  (select count(*) from public.source_facts
   where source_item_id = '51100000-0000-4000-8000-000000000021'),
  3::bigint,
  'retry creates one fact row per ordinal'
);

select ok(
  (select processed_at is not null from public.source_items
   where id = '51100000-0000-4000-8000-000000000021'),
  'normalization marks source processing complete'
);

select is(
  public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021',
    repeat('a', 64),
    2,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":2,"ordinal":0,"kind":"date","certainty":"certain",
      "value":{"role":"end","instant":"9999-12-31T23:59:59.999999999Z"},
      "provenance":[{"field":"attributes.dates"}]
    }]'::jsonb
  ),
  'stored',
  'canonical UTC date at supported upper year and millisecond precision is accepted'
);

select is(
  (select value ->> 'instant' from public.source_facts
   where source_item_id = '51100000-0000-4000-8000-000000000021'
     and normalizer_version = 2 and kind = 'date'),
  '9999-12-31T23:59:59.999999999Z',
  'canonical date remains exact in storage'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 3,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":3,"ordinal":0,"kind":"date","certainty":"certain",
      "value":{"role":"occurred","instant":"2026-08-29T10:00:00.000000000+01:00"},
      "provenance":[{"field":"occurredAt"}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source fact set',
  'persisted dates reject noncanonical offset form'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 3,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":3,"ordinal":0,"kind":"date","certainty":"certain",
      "value":{"role":"occurred","instant":"2026-02-30T10:00:00.000000000Z"},
      "provenance":[{"field":"occurredAt"}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source fact set',
  'persisted dates reject impossible calendar values'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 3,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":3,"ordinal":0,"kind":"location","certainty":"certain",
      "value":{"label":21},"provenance":[{"field":"attributes.location"}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source fact set',
  'location label must be a JSON string'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 3,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":3,"ordinal":0,"kind":"location","certainty":"certain",
      "value":{"label":"Example City","role":null},
      "provenance":[{"field":"attributes.location"}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source fact set',
  'present location role must be a JSON string'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 3,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":3,"ordinal":0,"kind":"reference","certainty":"certain",
      "value":{"kind":21,"value":"SYNTHETIC"},
      "provenance":[{"field":"attributes.reference"}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source fact set',
  'reference kind must be a JSON string'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 3,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":3,"ordinal":0,"kind":"reference","certainty":"certain",
      "value":{"kind":"order","value":null},
      "provenance":[{"field":"attributes.reference"}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source fact set',
  'reference value must be a JSON string'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 3,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":"3","ordinal":"0","kind":"currency","certainty":"certain",
      "value":"USD","provenance":[{"field":"attributes.currency"}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source fact set',
  'numeric contract fields reject JSON strings'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 3,
    '[
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":3,"ordinal":1,"kind":"currency","certainty":"certain",
        "value":"USD","provenance":[{"field":"attributes.currency"}]
      },
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":3,"ordinal":0,"kind":"amount","certainty":"certain",
        "value":"1.00","provenance":[{"field":"attributes.amount"}]
      }
    ]'::jsonb
  )$$,
  '22023', 'Invalid source fact set',
  'fact ordinal must equal JSON array position'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 3,
    jsonb_build_array(jsonb_build_object(
      'sourceItemId', '51100000-0000-4000-8000-000000000021',
      'normalizerVersion', 3,
      'ordinal', 0,
      'kind', 'currency',
      'certainty', 'certain',
      'value', 'USD',
      'provenance', jsonb_build_array(jsonb_build_object('field', repeat('x', 161)))
    ))
  )$$,
  '22023', 'Invalid source fact set',
  'provenance field is bounded to 160 characters'
);

select is(
  public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('a', 64), 4,
    '[
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":4,"ordinal":0,"kind":"date","certainty":"certain",
        "value":{"role":"start","instant":"2026-08-29T09:00:00.000100000Z"},
        "provenance":[{"field":"attributes.dates[0]"}]
      },
      {
        "sourceItemId":"51100000-0000-4000-8000-000000000021",
        "normalizerVersion":4,"ordinal":1,"kind":"date","certainty":"certain",
        "value":{"role":"end","instant":"2026-08-29T09:00:00.000900000Z"},
        "provenance":[{"field":"attributes.dates[1]"}]
      }
    ]'::jsonb
  ),
  'stored',
  'SQL accepts distinct canonical sub-millisecond fact instants'
);

select is(
  (select count(distinct value ->> 'instant') from public.source_facts
   where source_item_id = '51100000-0000-4000-8000-000000000021'
     and normalizer_version = 4),
  2::bigint,
  'SQL preserves distinct sub-millisecond fact instants'
);

select is(
  public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021', repeat('9', 64), 3,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":3,"ordinal":0,"kind":"currency","certainty":"certain",
      "value":"USD","provenance":[{"field":"attributes.currency"}]
    }]'::jsonb
  ),
  'fact-integrity-conflict',
  'same source ID with changed fact digest fails source binding'
);

select is(
  (select count(*) from public.source_facts
   where source_item_id = '51100000-0000-4000-8000-000000000021'
     and normalizer_version = 3),
  0::bigint,
  'source fingerprint conflict attaches no facts'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021',
    repeat('a', 64),
    1,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":1,"ordinal":0,"kind":"amount","certainty":"certain",
      "value":"999.99","provenance":[{"field":"attributes.amount"}]
    }]'::jsonb
  )$$,
  '23505',
  'Source fact version conflict',
  'same source and normalizer version cannot change facts'
);

select throws_ok(
  $$select public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '51100000-0000-4000-8000-000000000021',
    repeat('a', 64),
    3,
    '[{
      "sourceItemId":"51100000-0000-4000-8000-000000000021",
      "normalizerVersion":3,"ordinal":0,"kind":"amount","certainty":"certain",
      "value":"1.00",
      "provenance":[{"field":"attributes.amount","snippet":"plaintext is forbidden"}]
    }]'::jsonb
  )$$,
  '22023',
  'Invalid source fact set',
  'provenance cannot persist source snippets'
);

select is(
  public.persist_source_facts(
    '51000000-0000-4000-8000-000000000021',
    '52200000-0000-4000-8000-000000000021',
    repeat('b', 64),
    1,
    '[{
      "sourceItemId":"52200000-0000-4000-8000-000000000021",
      "normalizerVersion":1,"ordinal":0,"kind":"currency","certainty":"certain",
      "value":"USD","provenance":[{"field":"attributes.currency"}]
    }]'::jsonb
  ),
  'source-missing',
  'explicit tenant and source pair cannot cross ownership'
);

select is(
  public.persist_source_facts(
    '52000000-0000-4000-8000-000000000021',
    '52200000-0000-4000-8000-000000000021',
    repeat('b', 64),
    1,
    '[{
      "sourceItemId":"52200000-0000-4000-8000-000000000021",
      "normalizerVersion":1,"ordinal":0,"kind":"currency","certainty":"certain",
      "value":"EUR","provenance":[{"field":"attributes.currency"}]
    }]'::jsonb
  ),
  'stored',
  'second tenant can persist its own facts'
);

select is(
  public.record_dead_letter_item(
    '53300000-0000-4000-8000-000000000021',
    '51000000-0000-4000-8000-000000000021',
    '53400000-0000-4000-8000-000000000021',
    'fact_integrity_conflict',
    now(), now() + interval '7 days', 'development',
    decode(repeat('31', 16), 'hex'), decode(repeat('32', 12), 'hex'),
    decode(repeat('33', 48), 'hex'), decode(repeat('34', 12), 'hex'), 1, null
  ),
  true,
  'dead-letter RPC accepts fact integrity conflicts'
);

select is(
  (select failure_code from public.dead_letter_items
   where id = '53300000-0000-4000-8000-000000000021'),
  'fact_integrity_conflict',
  'dead-letter ledger preserves dedicated fact integrity code'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.persist_source_facts(uuid,uuid,text,integer,jsonb)',
    'execute'
  ),
  'authenticated users cannot call fact persistence directly'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"51000000-0000-4000-8000-000000000021","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.source_facts),
  7::bigint,
  'first user sees only first tenant facts'
);

select throws_ok(
  $$insert into public.source_facts (
      user_id, source_item_id, normalizer_version, ordinal, kind, certainty, value, provenance
    ) values (
      '51000000-0000-4000-8000-000000000021',
      '51100000-0000-4000-8000-000000000021',
      3, 0, 'currency', 'certain', '"USD"'::jsonb,
      '[{"field":"attributes.currency"}]'::jsonb
    )$$,
  '42501',
  null,
  'authenticated users cannot insert facts directly'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"52000000-0000-4000-8000-000000000021","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.source_facts),
  1::bigint,
  'second user sees only second tenant facts'
);

select is(
  (select count(*) from public.source_facts
   where source_item_id = '51100000-0000-4000-8000-000000000021'),
  0::bigint,
  'second user cannot address first tenant facts'
);

select * from finish();
rollback;
