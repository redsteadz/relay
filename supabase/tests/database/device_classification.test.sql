begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

-- Fixtures run as the migration role. `auth.users` inserts fire `handle_new_user`, which seeds the
-- ten system categories per tenant.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '70000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'filing-one@example.test', '', now(), now(), now()
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'filing-two@example.test', '', now(), now(), now()
  );

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint
) values
  (
    '70100000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    'email', 'filing-item-one', now(), now(), repeat('a', 64)
  ),
  (
    '70100000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000001',
    'email', 'filing-item-two', now(), now(), repeat('b', 64)
  ),
  (
    '70100000-0000-4000-8000-0000000000f2',
    '70000000-0000-4000-8000-000000000002',
    'email', 'filing-item-other-tenant', now(), now(), repeat('c', 64)
  );

insert into public.categories (id, user_id, slug, name) values (
  '70400000-0000-4000-8000-0000000000f2',
  '70000000-0000-4000-8000-000000000002',
  'other-tenant-category', 'Other tenant category'
);

insert into public.filter_rules (id, user_id, name, intent, plan) values (
  '70300000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000001',
  'Bank receipts', 'from the bank',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"from the bank","deterministic":{"field":"sender","operator":"contains","value":"bank"}}'
);

-- Acting as tenant one for every RPC assertion below.
select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

-- Direct writes ------------------------------------------------------------------------------------

select throws_ok(
  $q$insert into public.classifications (user_id, source_item_id, method, confidence)
    values ('70000000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001',
            'deterministic', 1.000)$q$,
  '42501',
  null,
  'a client cannot insert a classification directly'
);

select throws_ok(
  $q$update public.classifications set rationale = 'x'$q$,
  '42501',
  null,
  'a client cannot update a classification directly'
);

select throws_ok(
  $q$delete from public.classifications$q$,
  '42501',
  null,
  'a client cannot delete a classification directly'
);

-- The routine fixes what it will not trust ----------------------------------------------------------

select is(
  (
    select origin from public.record_device_classification_v1(
      '70100000-0000-4000-8000-000000000001',
      (select id from public.categories
        where user_id = '70000000-0000-4000-8000-000000000001' and slug = 'transaction'),
      '70300000-0000-4000-8000-000000000001',
      'Matched sender contains'
    )
  ),
  'device',
  'a classification recorded by a client is marked as coming from a device'
);

select is(
  (
    select method from public.classifications
    where source_item_id = '70100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  'deterministic',
  'a device classification is always deterministic'
);

select is(
  (
    select confidence from public.classifications
    where source_item_id = '70100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  1.000::numeric(4, 3),
  'a device asserts a boolean outcome rather than a confidence gradient'
);

select is(
  (
    select filter_rule_id from public.classifications
    where source_item_id = '70100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  '70300000-0000-4000-8000-000000000001'::uuid,
  'the rule revision that filed the capture is recorded'
);

-- Supersession ---------------------------------------------------------------------------------------

select lives_ok(
  $q$select public.record_device_classification_v1(
      '70100000-0000-4000-8000-000000000001',
      (select id from public.categories
        where user_id = '70000000-0000-4000-8000-000000000001' and slug = 'task')
    )$q$,
  'a device may refile a capture it filed before'
);

select is(
  (
    select count(*)::int from public.classifications
    where source_item_id = '70100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  1,
  'refiling leaves exactly one current classification'
);

select is(
  (
    select count(*)::int from public.classifications
    where source_item_id = '70100000-0000-4000-8000-000000000001'
  ),
  2,
  'the superseded classification is kept as history rather than overwritten'
);

select is(
  (
    select c.slug from public.classifications k
    join public.categories c on c.id = k.category_id
    where k.source_item_id = '70100000-0000-4000-8000-000000000001' and k.superseded_at is null
  ),
  'task',
  'the current classification is the most recent decision'
);

-- Tenant isolation -------------------------------------------------------------------------------------

select throws_ok(
  $q$select public.record_device_classification_v1('70100000-0000-4000-8000-0000000000f2')$q$,
  'P0002',
  null,
  'a capture belonging to another tenant is unavailable rather than confirmed'
);

select throws_ok(
  $q$select public.record_device_classification_v1(
      '70100000-0000-4000-8000-000000000002',
      '70400000-0000-4000-8000-0000000000f2'
    )$q$,
  'P0002',
  null,
  'a category belonging to another tenant cannot be filed into'
);

select is(
  (
    select count(*)::int from public.classifications
    where user_id = '70000000-0000-4000-8000-000000000002'
  ),
  0,
  'no classification was written for the other tenant'
);

-- A device never overrules the server ---------------------------------------------------------------

reset role;

insert into public.classifications (
  user_id, source_item_id, category_id, method, confidence, origin
) values (
  '70000000-0000-4000-8000-000000000001',
  '70100000-0000-4000-8000-000000000002',
  (select id from public.categories
    where user_id = '70000000-0000-4000-8000-000000000001' and slug = 'promotion'),
  'semantic', 0.900, 'server'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (
    select origin from public.record_device_classification_v1(
      '70100000-0000-4000-8000-000000000002',
      (select id from public.categories
        where user_id = '70000000-0000-4000-8000-000000000001' and slug = 'task')
    )
  ),
  'server',
  'a device call returns the server classification untouched'
);

select is(
  (
    select c.slug from public.classifications k
    join public.categories c on c.id = k.category_id
    where k.source_item_id = '70100000-0000-4000-8000-000000000002' and k.superseded_at is null
  ),
  'promotion',
  'a server classification is not superseded by a device'
);

select is(
  (
    select count(*)::int from public.classifications
    where source_item_id = '70100000-0000-4000-8000-000000000002'
  ),
  1,
  'no second row is written when the server already decided'
);

reset role;

-- Constraints hold against the migration role too ----------------------------------------------------

select throws_ok(
  $q$insert into public.classifications (user_id, source_item_id, method, confidence, origin)
    values ('70000000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001',
            'semantic', 1.000, 'device')$q$,
  '23514',
  null,
  'a device-origin classification cannot claim a semantic method'
);

select throws_ok(
  $q$insert into public.classifications (user_id, source_item_id, method, confidence, origin)
    values ('70000000-0000-4000-8000-000000000001', '70100000-0000-4000-8000-000000000001',
            'deterministic', 1.000, 'server')$q$,
  '23505',
  null,
  'a second current classification for one capture is refused'
);

-- Withdrawal ------------------------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select is(
  (
    select superseded_at is not null from public.withdraw_device_classification_v1(
      '70100000-0000-4000-8000-000000000001'
    )
  ),
  true,
  'withdrawing supersedes the classification rather than deleting it'
);

select is(
  (
    select count(*)::int from public.classifications
    where source_item_id = '70100000-0000-4000-8000-000000000001' and superseded_at is null
  ),
  0,
  'a withdrawn capture has no current classification'
);

select isnt(
  (
    select count(*)::int from public.classifications
    where source_item_id = '70100000-0000-4000-8000-000000000001'
  ),
  0,
  'the withdrawn decision is kept as history'
);

-- The server's row is not a device's to withdraw.
select is(
  (
    select origin from public.withdraw_device_classification_v1(
      '70100000-0000-4000-8000-000000000002'
    )
  ),
  'server',
  'a device cannot withdraw a server classification'
);

reset role;

select * from finish();
rollback;
