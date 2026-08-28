begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '40000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'persistence@example.test', '', now(), now(), now()
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '40000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'persistence-two@example.test', '', now(), now(), now()
);

select is(
  public.persist_encrypted_source_item_v2(
    '41000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000004',
    'notification', null, 'provider-item', 'com.example.synthetic', now(), now(), repeat('a', 64),
    now(), now() + interval '7 days',
    'production', decode(repeat('11', 16), 'hex'), decode(repeat('12', 12), 'hex'),
    decode(repeat('13', 48), 'hex'), decode(repeat('14', 12), 'hex'), 1
  ),
  true,
  'encrypted source persistence reports a new durable row'
);

select is(
  public.persist_encrypted_source_item_v2(
    '42000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000004',
    'notification', null, 'provider-item', 'com.example.synthetic', now(), now(), repeat('b', 64),
    now(), now() + interval '7 days',
    'production', decode(repeat('21', 16), 'hex'), decode(repeat('22', 12), 'hex'),
    decode(repeat('23', 48), 'hex'), decode(repeat('24', 12), 'hex'), 1
  ),
  false,
  'source identity conflict reports an idempotent duplicate'
);

select is(
  public.persist_encrypted_source_item_v2(
    '43000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000004',
    'notification', null, 'other-provider-item', 'com.example.synthetic', now(), now(), repeat('a', 64),
    now(), now() + interval '7 days',
    'production', decode(repeat('31', 16), 'hex'), decode(repeat('32', 12), 'hex'),
    decode(repeat('33', 48), 'hex'), decode(repeat('34', 12), 'hex'), 1
  ),
  false,
  'content fingerprint conflict reports an idempotent duplicate'
);

select is(
  (select count(*) from public.source_items
   where user_id = '40000000-0000-0000-0000-000000000004'),
  1::bigint,
  'duplicate outcomes do not create source rows'
);

select ok(
  not exists (
    select 1 from public.source_items
    where id in (
      '42000000-0000-0000-0000-000000000004',
      '43000000-0000-0000-0000-000000000004'
    )
  ),
  'duplicate outcomes do not cache candidate records durably'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.persist_encrypted_source_item_v2(uuid,uuid,public.source_kind,text,text,text,timestamptz,timestamptz,text,timestamptz,timestamptz,text,bytea,bytea,bytea,bytea,integer)',
    'execute'
  ),
  'authenticated users cannot call source persistence directly'
);

select throws_ok(
  $$select public.persist_encrypted_source_item_v2(
    '44000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000004',
    'notification', null, 'invalid-encryption', null, now(), now(), repeat('c', 64),
    now(), now() + interval '7 days',
    'production', decode(repeat('41', 16), 'hex'), decode(repeat('42', 11), 'hex'),
    decode(repeat('43', 48), 'hex'), decode(repeat('44', 12), 'hex'), 1
  )$$,
  '22023',
  'Invalid encrypted source item',
  'source persistence rejects malformed encryption components'
);

select throws_ok(
  $$select public.persist_encrypted_source_item_v2(
    '45000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000004',
    'notification', null, 'null-encryption', null, now(), now(), repeat('d', 64),
    now(), now() + interval '7 days', null, null, null, null, null, null
  )$$,
  '22023',
  'Invalid encrypted source item',
  'source persistence rejects null encryption components'
);

select throws_ok(
  $$select public.persist_encrypted_source_item_v2(
    '41000000-0000-0000-0000-000000000004',
    '40000000-0000-0000-0000-000000000005',
    'notification', null, 'other-tenant-item', null, now(), now(), repeat('e', 64),
    now(), now() + interval '7 days',
    'production', decode(repeat('51', 16), 'hex'), decode(repeat('52', 12), 'hex'),
    decode(repeat('53', 48), 'hex'), decode(repeat('54', 12), 'hex'), 1
  )$$,
  '23505',
  'Encrypted source item conflicts outside tenant',
  'cross-tenant source ID collision remains retryable'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.persist_encrypted_source_item(uuid,uuid,public.source_kind,text,text,text,timestamptz,timestamptz,text,text,bytea,bytea,bytea,bytea,integer)',
    'execute'
  ),
  'previous source RPC remains available during rolling deployment'
);

select * from finish();
rollback;
