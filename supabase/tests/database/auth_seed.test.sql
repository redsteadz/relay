begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select is(
  (select confirmation_token from auth.users
   where id = '00000000-0000-4000-8000-000000000001'),
  '',
  'local synthetic Auth user has a GoTrue-compatible confirmation token'
);

select is(
  (select recovery_token from auth.users
   where id = '00000000-0000-4000-8000-000000000001'),
  '',
  'local synthetic Auth user has a GoTrue-compatible recovery token'
);

select is(
  (select raw_app_meta_data ->> 'provider' from auth.users
   where id = '00000000-0000-4000-8000-000000000001'),
  'email',
  'local synthetic Auth user declares the email provider'
);

select ok(
  exists (
    select 1
    from auth.identities
    where user_id = '00000000-0000-4000-8000-000000000001'
      and provider = 'email'
  ),
  'local synthetic Auth user has an email identity'
);

select * from finish();
rollback;
