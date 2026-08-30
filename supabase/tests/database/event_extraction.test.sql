begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '61000000-0000-4000-8000-000000000025',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'events-one@example.test', '', now(), now(), now()
  ),
  (
    '62000000-0000-4000-8000-000000000025',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'events-two@example.test', '', now(), now(), now()
  );

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint,
  fact_set_fingerprint
) values
  (
    '61100000-0000-4000-8000-000000000025',
    '61000000-0000-4000-8000-000000000025',
    'notification', 'synthetic-event-source-one', now(), now(), repeat('1', 64), repeat('a', 64)
  ),
  (
    '62200000-0000-4000-8000-000000000025',
    '62000000-0000-4000-8000-000000000025',
    'sms', 'synthetic-event-source-two', now(), now(), repeat('2', 64), repeat('b', 64)
  );

select is(
  public.persist_source_facts(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025',
    repeat('a', 64),
    1,
    '[
      {
        "sourceItemId":"61100000-0000-4000-8000-000000000025",
        "normalizerVersion":1,"ordinal":0,"kind":"amount","certainty":"certain",
        "value":"14.20","provenance":[{"field":"attributes.amount"}]
      },
      {
        "sourceItemId":"61100000-0000-4000-8000-000000000025",
        "normalizerVersion":1,"ordinal":1,"kind":"currency","certainty":"certain",
        "value":"USD","provenance":[{"field":"attributes.currency"}]
      },
      {
        "sourceItemId":"61100000-0000-4000-8000-000000000025",
        "normalizerVersion":1,"ordinal":2,"kind":"merchant","certainty":"certain",
        "value":"Example Station","provenance":[{"field":"attributes.merchant"}]
      },
      {
        "sourceItemId":"61100000-0000-4000-8000-000000000025",
        "normalizerVersion":1,"ordinal":3,"kind":"reference","certainty":"certain",
        "value":{"kind":"tracking","value":"TRACK-SYNTHETIC-25"},
        "provenance":[{"field":"attributes.reference"}]
      },
      {
        "sourceItemId":"61100000-0000-4000-8000-000000000025",
        "normalizerVersion":1,"ordinal":4,"kind":"date","certainty":"certain",
        "value":{"role":"start","instant":"2026-09-02T03:30:00.000100000Z"},
        "provenance":[{"field":"attributes.dates[0]"}]
      },
      {
        "sourceItemId":"61100000-0000-4000-8000-000000000025",
        "normalizerVersion":1,"ordinal":5,"kind":"date","certainty":"certain",
        "value":{"role":"end","instant":"2026-09-02T04:00:00.000900000Z"},
        "provenance":[{"field":"attributes.dates[1]"}]
      },
      {
        "sourceItemId":"61100000-0000-4000-8000-000000000025",
        "normalizerVersion":1,"ordinal":6,"kind":"date","certainty":"certain",
        "value":{"role":"due","instant":"2026-08-31T10:00:00.000000000Z"},
        "provenance":[{"field":"attributes.dates[2]"}]
      },
      {
        "sourceItemId":"61100000-0000-4000-8000-000000000025",
        "normalizerVersion":1,"ordinal":7,"kind":"date","certainty":"uncertain",
        "uncertaintyReason":"invalid","provenance":[{"field":"attributes.dates[3]"}]
      }
    ]'::jsonb
  ),
  'stored',
  'normalized facts are stored before event extraction'
);

select is(
  public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025',
    repeat('a', 64), 1, 1, repeat('c', 64),
    '[{
      "sourceItemId":"61100000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":1,"ordinal":0,"kind":"fact",
      "title":"USD 14.20 at Example Station",
      "summary":"Amount: USD 14.20. Merchant: Example Station. Transaction reference available.",
      "confidence":0.95,"requiresReview":false,"temporalStatus":"none","timeZone":null,
      "provenance":[
        {"factOrdinal":0,"fields":[{"field":"attributes.amount"}]},
        {"factOrdinal":1,"fields":[{"field":"attributes.currency"}]},
        {"factOrdinal":2,"fields":[{"field":"attributes.merchant"}]}
      ]
    }]'::jsonb
  ),
  'stored',
  'first transaction event is stored'
);

select is(
  public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025',
    repeat('a', 64), 1, 1, repeat('c', 64),
    '[{
      "sourceItemId":"61100000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":1,"ordinal":0,"kind":"fact",
      "title":"USD 14.20 at Example Station",
      "summary":"Amount: USD 14.20. Merchant: Example Station. Transaction reference available.",
      "confidence":0.95,"requiresReview":false,"temporalStatus":"none","timeZone":null,
      "provenance":[
        {"factOrdinal":0,"fields":[{"field":"attributes.amount"}]},
        {"factOrdinal":1,"fields":[{"field":"attributes.currency"}]},
        {"factOrdinal":2,"fields":[{"field":"attributes.merchant"}]}
      ]
    }]'::jsonb
  ),
  'duplicate',
  'exact event retry is idempotent'
);

select is(
  (select count(*) from public.relay_events
   where source_item_id = '61100000-0000-4000-8000-000000000025'
     and normalizer_version = 1 and extractor_version = 1),
  1::bigint,
  'event retry leaves one source and extractor row'
);

select throws_ok(
  $$select public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025', repeat('a', 64), 1, 1, repeat('d', 64),
    '[{
      "sourceItemId":"61100000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":1,"ordinal":0,"kind":"fact",
      "title":"Changed output","summary":"Changed output.","confidence":0.95,
      "requiresReview":false,"temporalStatus":"none","timeZone":null,
      "provenance":[{"factOrdinal":0,"fields":[{"field":"attributes.amount"}]}]
    }]'::jsonb
  )$$,
  '23505', 'Source event version conflict',
  'changed output under one extractor identity fails closed'
);

select is(
  public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025', repeat('a', 64), 1, 2, repeat('e', 64),
    '[{
      "sourceItemId":"61100000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":2,"ordinal":0,"kind":"task",
      "title":"Track delivery","summary":"Tracking reference available.","confidence":0.85,
      "requiresReview":false,"temporalStatus":"none","timeZone":null,
      "provenance":[{"factOrdinal":3,"fields":[{"field":"attributes.reference"}]}]
    }]'::jsonb
  ),
  'stored',
  'new extractor version stores a distinct delivery task'
);

select is(
  (select count(*) from public.relay_events
   where source_item_id = '61100000-0000-4000-8000-000000000025'),
  2::bigint,
  'source retains one row per completed extractor version'
);

select is(
  public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025', repeat('a', 64), 1, 3, repeat('f', 64),
    '[{
      "sourceItemId":"61100000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":3,"ordinal":0,"kind":"calendar-event",
      "title":"Event at Example Clinic","summary":"Location: Example Clinic.","confidence":0.95,
      "requiresReview":false,"temporalStatus":"resolved","timeZone":"UTC",
      "startsAt":"2026-09-02T03:30:00.000100000Z",
      "endsAt":"2026-09-02T04:00:00.000900000Z",
      "provenance":[
        {"factOrdinal":4,"fields":[{"field":"attributes.dates[0]"}]},
        {"factOrdinal":5,"fields":[{"field":"attributes.dates[1]"}]}
      ]
    }]'::jsonb
  ),
  'stored',
  'appointment event stores resolved UTC range'
);

select is(
  (select starts_at_canonical from public.relay_events
   where source_item_id = '61100000-0000-4000-8000-000000000025' and extractor_version = 3),
  '2026-09-02T03:30:00.000100000Z',
  'event start preserves exact canonical instant text'
);

select is(
  (select ends_at_canonical from public.relay_events
   where source_item_id = '61100000-0000-4000-8000-000000000025' and extractor_version = 3),
  '2026-09-02T04:00:00.000900000Z',
  'event end preserves exact canonical instant text'
);

select is(
  public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025', repeat('a', 64), 1, 4, repeat('8', 64),
    '[{
      "sourceItemId":"61100000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":4,"ordinal":0,"kind":"reminder",
      "title":"Reminder from Example Security","summary":"Security review due.","confidence":0.6,
      "requiresReview":true,"temporalStatus":"resolved","timeZone":"UTC",
      "dueAt":"2026-08-31T10:00:00.000000000Z",
      "provenance":[
        {"factOrdinal":6,"fields":[{"field":"attributes.dates[2]"}]},
        {"factOrdinal":7,"fields":[{"field":"attributes.dates[3]"}]}
      ]
    }]'::jsonb
  ),
  'stored',
  'low-confidence security reminder remains visible'
);

select ok(
  (select requires_review and confidence = 0.6
   from public.relay_events
   where source_item_id = '61100000-0000-4000-8000-000000000025' and extractor_version = 4),
  'low-confidence reminder is review-only'
);

select throws_ok(
  $$select public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025', repeat('a', 64), 1, 5, repeat('9', 64),
    '[{
      "sourceItemId":"61100000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":5,"ordinal":0,"kind":"fact",
      "title":"Unsafe low confidence","summary":"Must require review.","confidence":0.6,
      "requiresReview":false,"temporalStatus":"none","timeZone":null,
      "provenance":[{"factOrdinal":0,"fields":[{"field":"attributes.amount"}]}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source event set',
  'low confidence cannot clear review requirement'
);

select throws_ok(
  $$select public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025', repeat('a', 64), 1, 5, repeat('9', 64),
    '[{
      "sourceItemId":"61100000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":5,"ordinal":0,"kind":"reminder",
      "title":"Ambiguous reminder","summary":"Date needs review.","confidence":0.6,
      "requiresReview":true,"temporalStatus":"ambiguous","timeZone":null,
      "dateAmbiguity":"invalid","dueAt":"2026-08-31T10:00:00.000000000Z",
      "provenance":[{"factOrdinal":7,"fields":[{"field":"attributes.dates[3]"}]}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source event set',
  'ambiguous date cannot carry a guessed instant'
);

select throws_ok(
  $$select public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '61100000-0000-4000-8000-000000000025', repeat('a', 64), 1, 5, repeat('9', 64),
    '[{
      "sourceItemId":"61100000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":5,"ordinal":0,"kind":"fact",
      "title":"Invalid provenance","summary":"Invalid provenance.","confidence":0.95,
      "requiresReview":false,"temporalStatus":"none","timeZone":null,
      "provenance":[{"factOrdinal":0,"fields":[{"field":"attributes.currency"}]}]
    }]'::jsonb
  )$$,
  '22023', 'Invalid source event set',
  'event provenance must match stored fact field paths'
);

select is(
  public.persist_source_events(
    '61000000-0000-4000-8000-000000000025',
    '62200000-0000-4000-8000-000000000025', repeat('b', 64), 1, 1, repeat('b', 64),
    '[{
      "sourceItemId":"62200000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":1,"ordinal":0,"kind":"fact",
      "title":"Cross tenant","summary":"Cross tenant.","confidence":0.95,
      "requiresReview":false,"temporalStatus":"none","timeZone":null,
      "provenance":[{"factOrdinal":0,"fields":[{"field":"sender"}]}]
    }]'::jsonb
  ),
  'source-missing',
  'explicit tenant and source pair cannot cross ownership'
);

select is(
  public.persist_source_facts(
    '62000000-0000-4000-8000-000000000025',
    '62200000-0000-4000-8000-000000000025', repeat('b', 64), 1,
    '[{
      "sourceItemId":"62200000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"ordinal":0,"kind":"sender","certainty":"certain",
      "value":"Example Sender","provenance":[{"field":"sender"}]
    }]'::jsonb
  ),
  'stored',
  'second tenant stores own normalized facts'
);

select is(
  public.persist_source_events(
    '62000000-0000-4000-8000-000000000025',
    '62200000-0000-4000-8000-000000000025', repeat('b', 64), 1, 1, repeat('b', 64),
    '[{
      "sourceItemId":"62200000-0000-4000-8000-000000000025",
      "normalizerVersion":1,"extractorVersion":1,"ordinal":0,"kind":"fact",
      "title":"Notice from Example Sender","summary":"Sender: Example Sender.","confidence":0.75,
      "requiresReview":true,"temporalStatus":"none","timeZone":null,
      "provenance":[{"factOrdinal":0,"fields":[{"field":"sender"}]}]
    }]'::jsonb
  ),
  'stored',
  'second tenant stores own event'
);

select lives_ok(
  $$insert into public.relay_events (
      id, user_id, source_item_id, kind, title, summary, confidence, provenance
    ) values (
      '61200000-0000-4000-8000-000000000025',
      '61000000-0000-4000-8000-000000000025',
      '61100000-0000-4000-8000-000000000025',
      'fact', 'Legacy event', '', 0.5, '{}'::jsonb
    )$$,
  'all-null legacy extraction metadata remains valid'
);

select throws_ok(
  $$insert into public.relay_events (
      id, user_id, source_item_id, kind, title, summary, confidence, provenance, extractor_version
    ) values (
      '61300000-0000-4000-8000-000000000025',
      '61000000-0000-4000-8000-000000000025',
      '61100000-0000-4000-8000-000000000025',
      'fact', 'Partial event', 'Partial event.', 0.5,
      '[{"factOrdinal":0,"fields":[{"field":"attributes.amount"}]}]'::jsonb, 9
    )$$,
  '23514',
  null,
  'partial canonical extraction metadata fails closed'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.persist_source_events(uuid,uuid,text,integer,integer,text,jsonb)',
    'execute'
  ),
  false,
  'authenticated role cannot execute event persistence RPC'
);

select is(
  public.record_dead_letter_item(
    '63300000-0000-4000-8000-000000000025',
    '61000000-0000-4000-8000-000000000025',
    '63400000-0000-4000-8000-000000000025',
    'event_integrity_conflict',
    now(), now() + interval '7 days', 'development',
    decode(repeat('31', 16), 'hex'), decode(repeat('32', 12), 'hex'),
    decode(repeat('33', 48), 'hex'), decode(repeat('34', 12), 'hex'), 1, null
  ),
  true,
  'dead-letter RPC accepts event integrity conflicts'
);

select is(
  (select failure_code from public.dead_letter_items
   where id = '63300000-0000-4000-8000-000000000025'),
  'event_integrity_conflict',
  'dead-letter ledger preserves event integrity code'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"61000000-0000-4000-8000-000000000025","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.relay_events),
  5::bigint,
  'authenticated user sees own extracted events only'
);

select * from finish();
rollback;
