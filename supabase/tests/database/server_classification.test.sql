begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

-- Fixtures run as the migration role. `auth.users` inserts fire `handle_new_user`, which seeds the
-- ten system categories per tenant.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '71000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'server-filing-one@example.test', '', now(), now(), now()
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'server-filing-two@example.test', '', now(), now(), now()
  );

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint
) values
  (
    '71100000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'email', 'server-filing-item-one', now(), now(), repeat('d', 64)
  ),
  (
    '71100000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000001',
    'email', 'server-filing-item-two', now(), now(), repeat('e', 64)
  );

insert into public.categories (id, user_id, slug, name) values
  (
    '71400000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'server-receipts', 'Server receipts'
  ),
  (
    '71400000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000001',
    'server-travel', 'Server travel'
  ),
  (
    '71400000-0000-4000-8000-0000000000f2',
    '71000000-0000-4000-8000-000000000002',
    'other-tenant-server-category', 'Other tenant category'
  );

insert into public.filter_rules (id, user_id, name, intent, plan) values
  (
    '71300000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'Bank receipts', 'from the bank',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from the bank","deterministic":{"field":"sender","operator":"contains","value":"bank"}}'
  ),
  (
    '71300000-0000-4000-8000-0000000000f2',
    '71000000-0000-4000-8000-000000000002',
    'Other tenant rule', 'from the bank',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"from the bank","deterministic":{"field":"sender","operator":"contains","value":"bank"}}'
  );

-- Grant ---------------------------------------------------------------------------------------------
-- The tenant is a parameter here, so the grant is the only thing confining this routine to the
-- pipeline. An authenticated caller holding it could author the server-origin row that
-- 202609070001 requires before a category may gate an irreversible provider effect.

select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $q$select public.record_server_classification_v1(
      '71000000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000001')$q$,
  '42501',
  null,
  'an authenticated client cannot author a server classification'
);

-- A device files the capture first, so the supersede below has something to overrule.
select is(
  (
    select origin from public.record_device_classification_v1(
      '71100000-0000-4000-8000-000000000001',
      '71400000-0000-4000-8000-000000000001',
      '71300000-0000-4000-8000-000000000001',
      'device filed it'
    )
  ),
  'device',
  'the device files the capture first'
);

reset role;
set local role service_role;

-- Superseding ---------------------------------------------------------------------------------------

select is(
  (
    select origin from public.record_server_classification_v1(
      '71000000-0000-4000-8000-000000000001',
      '71100000-0000-4000-8000-000000000001',
      '71400000-0000-4000-8000-000000000002',
      '71300000-0000-4000-8000-000000000001',
      'deterministic', 1.000, null, 'server filed it'
    )
  ),
  'server',
  'the server overrules a current device classification'
);

select is(
  (
    select count(*)::int from public.classifications
    where source_item_id = '71100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  1,
  'the capture still has exactly one current classification'
);

select is(
  (
    select count(*)::int from public.classifications
    where source_item_id = '71100000-0000-4000-8000-000000000001' and superseded_at is not null
  ),
  1,
  'the device decision is kept as history rather than deleted'
);

select is(
  (
    select category_id from public.classifications
    where source_item_id = '71100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  '71400000-0000-4000-8000-000000000002'::uuid,
  'the current row carries the category the server chose'
);

select is(
  (
    select filter_rule_id from public.classifications
    where source_item_id = '71100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  '71300000-0000-4000-8000-000000000001'::uuid,
  'the rule revision that filed the capture is recorded'
);

-- Re-filing -----------------------------------------------------------------------------------------
-- The defect in #203: a blind insert cannot supersede, so a second server pass over the same capture
-- violated `classifications_current_per_item_idx` instead of re-filing it.

select lives_ok(
  $q$select public.record_server_classification_v1(
      '71000000-0000-4000-8000-000000000001',
      '71100000-0000-4000-8000-000000000001',
      '71400000-0000-4000-8000-000000000001',
      '71300000-0000-4000-8000-000000000001',
      'deterministic', 1.000, null, 'server re-filed it')$q$,
  'the server can re-file a capture it already classified'
);

select is(
  (
    select count(*)::int from public.classifications
    where source_item_id = '71100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  1,
  're-filing leaves exactly one current classification'
);

select is(
  (
    select count(*)::int from public.classifications
    where source_item_id = '71100000-0000-4000-8000-000000000001'
  ),
  3,
  'every earlier decision is retained as history'
);

select is(
  (
    select category_id from public.classifications
    where source_item_id = '71100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  '71400000-0000-4000-8000-000000000001'::uuid,
  'the newest server decision is the current one'
);

-- A first classification needs no existing row to supersede.
select is(
  (
    select origin from public.record_server_classification_v1(
      '71000000-0000-4000-8000-000000000001',
      '71100000-0000-4000-8000-000000000002',
      null, null, 'semantic', 0.820, 'gpt-4o-mini', 'semantic clause matched'
    )
  ),
  'server',
  'a capture with no classification is filed without a row to supersede'
);

select is(
  (
    select method from public.classifications
    where source_item_id = '71100000-0000-4000-8000-000000000002' and superseded_at is null
  ),
  'semantic',
  'a semantic answer keeps its method, which a device could never assert'
);

-- Validation ----------------------------------------------------------------------------------------

select throws_ok(
  $q$select public.record_server_classification_v1(
      '71000000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000002',
      null, null, 'manual')$q$,
  '22023',
  null,
  'a manual correction is not the pipeline to assert'
);

select throws_ok(
  $q$select public.record_server_classification_v1(
      '71000000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000002',
      null, null, 'deterministic', 1.500)$q$,
  '22023',
  null,
  'confidence outside zero to one is refused'
);

select throws_ok(
  $q$select public.record_server_classification_v1(
      '71000000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-0000000000ff')$q$,
  'P0002',
  null,
  'a capture the tenant does not own is unavailable'
);

select throws_ok(
  $q$select public.record_server_classification_v1(
      '71000000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000002',
      '71400000-0000-4000-8000-0000000000f2')$q$,
  'P0002',
  null,
  'a category belonging to another tenant is unavailable'
);

select throws_ok(
  $q$select public.record_server_classification_v1(
      '71000000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000002',
      null, '71300000-0000-4000-8000-0000000000f2')$q$,
  'P0002',
  null,
  'a filter rule belonging to another tenant is unavailable'
);

-- Precedence the other way --------------------------------------------------------------------------
-- ADR-0014 in both directions: the server overrules a device, and a device never overrules the
-- server.

reset role;
select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (
    select origin from public.record_device_classification_v1(
      '71100000-0000-4000-8000-000000000001',
      '71400000-0000-4000-8000-000000000002',
      '71300000-0000-4000-8000-000000000001',
      'device tries again'
    )
  ),
  'server',
  'a device still cannot overrule the server row it now faces'
);

reset role;

select * from finish();
rollback;
