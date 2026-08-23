begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'one@example.test', '', now(), now(), now()
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'two@example.test', '', now(), now(), now()
  );

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  'select user_id from public.profiles order by user_id',
  $$values ('10000000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own profile'
);

select results_eq(
  'select count(*)::bigint from public.categories',
  'values (10::bigint)',
  'user sees only own default categories'
);

select lives_ok(
  $$insert into public.devices (user_id, name, platform)
    values ('10000000-0000-0000-0000-000000000001', 'Synthetic device', 'android')$$,
  'user can register own device'
);

select throws_ok(
  $$insert into public.devices (user_id, name, platform)
    values ('20000000-0000-0000-0000-000000000002', 'Cross-tenant device', 'android')$$,
  '42501',
  null,
  'user cannot register another tenant device'
);

select * from finish();
rollback;
