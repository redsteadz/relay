begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '30000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'rotation@example.test', '', now(), now(), now()
);

insert into public.connections (
  id, user_id, provider, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce,
  key_version, encryption_environment
) values (
  '31000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000003',
  'synthetic', decode(repeat('01', 16), 'hex'), decode(repeat('02', 12), 'hex'),
  decode(repeat('03', 48), 'hex'), decode(repeat('04', 12), 'hex'), 1, 'development'
);

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint,
  raw_ciphertext, raw_nonce, wrapped_data_key, wrap_nonce, key_version, encryption_environment
) values (
  '32000000-0000-0000-0000-000000000003',
  '30000000-0000-0000-0000-000000000003',
  'email', 'rotation-synthetic', now(), now(), 'rotation-fingerprint',
  decode(repeat('11', 16), 'hex'), decode(repeat('12', 12), 'hex'),
  decode(repeat('13', 48), 'hex'), decode(repeat('14', 12), 'hex'), 1, 'production'
);

select results_eq(
  $$select store, key_version, row_count
    from public.kek_encryption_inventory('development')$$,
  $$values ('connections'::text, 1, 1::bigint)$$,
  'inventory groups development connection key versions'
);

select results_eq(
  $$select store, key_version, row_count
    from public.kek_encryption_inventory('production')$$,
  $$values ('source_items'::text, 1, 1::bigint)$$,
  'inventory groups production source key versions'
);

select is(
  public.cas_rewrap_connection_data_key(
    'development',
    '31000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000003',
    1,
    decode(repeat('03', 48), 'hex'), decode(repeat('04', 12), 'hex'),
    decode(repeat('01', 16), 'hex'), decode(repeat('02', 12), 'hex'),
    2,
    decode(repeat('05', 48), 'hex'), decode(repeat('06', 12), 'hex')
  ),
  true,
  'connection compare-and-set succeeds for exact encrypted tuple'
);

select is(
  (select key_version from public.connections where id = '31000000-0000-0000-0000-000000000003'),
  2,
  'connection compare-and-set updates key version'
);

select is(
  (select encode(wrapped_data_key, 'hex') from public.connections
   where id = '31000000-0000-0000-0000-000000000003'),
  repeat('05', 48),
  'connection compare-and-set updates wrapped key'
);

select is(
  (select encode(credential_ciphertext, 'hex') from public.connections
   where id = '31000000-0000-0000-0000-000000000003'),
  repeat('01', 16),
  'connection compare-and-set preserves payload ciphertext'
);

select is(
  (select encode(credential_nonce, 'hex') from public.connections
   where id = '31000000-0000-0000-0000-000000000003'),
  repeat('02', 12),
  'connection compare-and-set preserves payload nonce'
);

select is(
  public.cas_rewrap_connection_data_key(
    'development',
    '31000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000003',
    1,
    decode(repeat('03', 48), 'hex'), decode(repeat('04', 12), 'hex'),
    decode(repeat('01', 16), 'hex'), decode(repeat('02', 12), 'hex'),
    2,
    decode(repeat('07', 48), 'hex'), decode(repeat('08', 12), 'hex')
  ),
  false,
  'stale connection compare-and-set changes no row'
);

select is(
  public.cas_rewrap_source_item_data_key(
    'development',
    '32000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000003',
    1,
    decode(repeat('13', 48), 'hex'), decode(repeat('14', 12), 'hex'),
    decode(repeat('11', 16), 'hex'), decode(repeat('12', 12), 'hex'),
    2,
    decode(repeat('15', 48), 'hex'), decode(repeat('16', 12), 'hex')
  ),
  false,
  'cross-environment source compare-and-set changes no row'
);

select is(
  public.cas_rewrap_source_item_data_key(
    'production',
    '32000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000003',
    1,
    decode(repeat('13', 48), 'hex'), decode(repeat('14', 12), 'hex'),
    decode(repeat('11', 16), 'hex'), decode(repeat('12', 12), 'hex'),
    2,
    decode(repeat('15', 48), 'hex'), decode(repeat('16', 12), 'hex')
  ),
  true,
  'source compare-and-set succeeds for exact environment and tuple'
);

select is(
  (select encode(raw_ciphertext, 'hex') from public.source_items
   where id = '32000000-0000-0000-0000-000000000003'),
  repeat('11', 16),
  'source compare-and-set preserves payload ciphertext'
);

select throws_ok(
  $$select public.cas_rewrap_source_item_data_key(
    'production',
    '32000000-0000-0000-0000-000000000003',
    '30000000-0000-0000-0000-000000000003',
    2,
    decode(repeat('15', 48), 'hex'), decode(repeat('16', 12), 'hex'),
    decode(repeat('11', 16), 'hex'), decode(repeat('12', 12), 'hex'),
    3,
    decode(repeat('17', 47), 'hex'), decode(repeat('18', 12), 'hex')
  )$$,
  '22023',
  'Invalid source item rewrap request',
  'rewrap rejects malformed wrapped-key length'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.kek_encryption_inventory(text)',
    'execute'
  ),
  'authenticated users cannot inventory encryption versions'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.cas_rewrap_connection_data_key(text,uuid,uuid,integer,bytea,bytea,bytea,bytea,integer,bytea,bytea)',
    'execute'
  ),
  'authenticated users cannot rewrap connection data keys'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.cas_rewrap_source_item_data_key(text,uuid,uuid,integer,bytea,bytea,bytea,bytea,integer,bytea,bytea)',
    'execute'
  ),
  'authenticated users cannot rewrap source data keys'
);

update public.source_items
set raw_expires_at = '2030-01-01T00:00:00Z'
where id = '32000000-0000-0000-0000-000000000003';

select is(
  public.purge_expired_raw_payloads('2029-12-31T23:59:59Z'),
  0::bigint,
  'controlled retention keeps unexpired source ciphertext'
);

select is(
  public.purge_expired_raw_payloads('2030-01-01T00:00:01Z'),
  1::bigint,
  'controlled retention purges expired source ciphertext'
);

select is(
  (select encryption_environment from public.source_items
   where id = '32000000-0000-0000-0000-000000000003'),
  null,
  'retention clears source encryption environment ownership'
);

select ok(
  (select raw_ciphertext is null from public.source_items
   where id = '32000000-0000-0000-0000-000000000003'),
  'retention clears source ciphertext'
);

select ok(
  (select raw_nonce is null from public.source_items
   where id = '32000000-0000-0000-0000-000000000003'),
  'retention clears source payload nonce'
);

select ok(
  (select wrapped_data_key is null from public.source_items
   where id = '32000000-0000-0000-0000-000000000003'),
  'retention clears wrapped source data key'
);

select ok(
  (select wrap_nonce is null from public.source_items
   where id = '32000000-0000-0000-0000-000000000003'),
  'retention clears source wrapping nonce'
);

select ok(
  (select key_version is null from public.source_items
   where id = '32000000-0000-0000-0000-000000000003'),
  'retention clears source key version'
);

select ok(
  exists (
    select 1 from public.source_items
    where id = '32000000-0000-0000-0000-000000000003'
      and content_fingerprint = 'rotation-fingerprint'
  ),
  'retention preserves source metadata'
);

select throws_ok(
  $$insert into public.connections (
      id, user_id, provider, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce,
      encryption_environment
    ) values (
      '33000000-0000-0000-0000-000000000003',
      '30000000-0000-0000-0000-000000000003',
      'invalid-environment', decode('00', 'hex'), decode('01', 'hex'),
      decode('02', 'hex'), decode('03', 'hex'), 'staging'
    )$$,
  '23514',
  null,
  'connections reject unknown encryption environments'
);

select * from finish();
rollback;
