begin;

create extension if not exists pgtap with schema extensions;
select plan(47);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values (
  '50000000-0000-0000-0000-000000000005',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'recovery@example.test', '', now(), now(), now()
);

select is(
  public.record_dead_letter_item(
    '51000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    '52000000-0000-0000-0000-000000000005',
    'retry_exhausted_unknown',
    '2030-01-01T00:00:00Z',
    '2030-01-08T00:00:00Z',
    'production',
    decode(repeat('11', 16), 'hex'), decode(repeat('12', 12), 'hex'),
    decode(repeat('13', 48), 'hex'), decode(repeat('14', 12), 'hex'), 1, null
  ),
  true,
  'unexpired dead-letter ciphertext is recoverable'
);

select results_eq(
  $$select failure_code, status, key_version, replay_count
    from public.list_dead_letter_items(100)
    where id = '51000000-0000-0000-0000-000000000005'$$,
  $$values ('retry_exhausted_unknown'::text, 'available'::text, 1, 0)$$,
  'operator inventory exposes stable metadata without ciphertext'
);

select is(
  (
    select count(*)
    from public.claim_dead_letter_replay(
      '51000000-0000-0000-0000-000000000005',
      '53000000-0000-0000-0000-000000000005'
    )
  ),
  1::bigint,
  'first replay request atomically claims ciphertext'
);

select is(
  (
    select count(*)
    from public.claim_dead_letter_replay(
      '51000000-0000-0000-0000-000000000005',
      '53000000-0000-0000-0000-000000000005'
    )
  ),
  1::bigint,
  'same request ID can recover its existing claim'
);

select is(
  (
    select count(*)
    from public.claim_dead_letter_replay(
      '51000000-0000-0000-0000-000000000005',
      '54000000-0000-0000-0000-000000000005'
    )
  ),
  0::bigint,
  'different request ID cannot duplicate an active replay'
);

select is(
  (select replay_count from public.dead_letter_items
   where id = '51000000-0000-0000-0000-000000000005'),
  1,
  'idempotent claim increments replay count once'
);

select is(
  public.complete_dead_letter_replay(
    '51000000-0000-0000-0000-000000000005',
    '53000000-0000-0000-0000-000000000005',
    'succeeded'
  ),
  true,
  'matching request completes replay'
);

select is(
  public.complete_dead_letter_replay(
    '51000000-0000-0000-0000-000000000005',
    '53000000-0000-0000-0000-000000000005',
    'duplicate'
  ),
  true,
  'duplicate Queue delivery completes idempotently after terminal replay'
);

select is(
  public.record_dead_letter_item(
    '51000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    '52000000-0000-0000-0000-000000000005',
    'coordinator_unavailable',
    '2030-01-01T00:00:00Z',
    '2030-01-08T00:00:00Z',
    'production',
    decode(repeat('61', 16), 'hex'), decode(repeat('62', 12), 'hex'),
    decode(repeat('63', 48), 'hex'), decode(repeat('64', 12), 'hex'), 1,
    '53000000-0000-0000-0000-000000000005'
  ),
  false,
  'late DLQ delivery cannot resurrect completed replay ciphertext'
);

select is(
  (select status from public.dead_letter_items
   where id = '51000000-0000-0000-0000-000000000005'),
  'succeeded',
  'completed replay records terminal status'
);

select ok(
  (select ciphertext is null and wrapped_data_key is null and key_version is null
   from public.dead_letter_items
   where id = '51000000-0000-0000-0000-000000000005'),
  'completed replay destroys recoverable ciphertext'
);

select is(
  (
    select count(*)
    from public.claim_dead_letter_replay(
      '51000000-0000-0000-0000-000000000005',
      '55000000-0000-0000-0000-000000000005'
    )
  ),
  0::bigint,
  'completed replay cannot be claimed again'
);

select is(
  (select count(*) from public.audit_log
   where target_id = '51000000-0000-0000-0000-000000000005'
     and action in ('dead_letter.recorded', 'dead_letter.replay_requested', 'dead_letter.replay_completed')),
  3::bigint,
  'recovery transitions write one metadata-only audit event per state transition'
);

select ok(
  not exists (
    select 1 from public.audit_log
    where target_id = '51000000-0000-0000-0000-000000000005'
      and metadata ?| array['ciphertext', 'nonce', 'wrappedDataKey', 'rawPayload']
  ),
  'recovery audit metadata excludes encrypted and plaintext payload fields'
);

select is(
  public.record_dead_letter_item(
    '56000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    '57000000-0000-0000-0000-000000000005',
    'retry_exhausted_unknown',
    '2020-01-01T00:00:00Z',
    '2020-01-08T00:00:00Z',
    'production',
    decode(repeat('21', 16), 'hex'), decode(repeat('22', 12), 'hex'),
    decode(repeat('23', 48), 'hex'), decode(repeat('24', 12), 'hex'), 1, null
  ),
  false,
  'already-expired dead-letter item is recorded without recoverable ciphertext'
);

select ok(
  (select status = 'expired' and ciphertext is null and encryption_environment is null
   from public.dead_letter_items
   where id = '56000000-0000-0000-0000-000000000005'),
  'expired payload cannot be resurrected when DLQ delivery is delayed'
);

select is(
  (
    select count(*)
    from public.claim_dead_letter_replay(
      '56000000-0000-0000-0000-000000000005',
      '58000000-0000-0000-0000-000000000005'
    )
  ),
  0::bigint,
  'expired dead-letter item cannot be replayed'
);

select throws_ok(
  $$select public.record_dead_letter_item(
    '59000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    '5a000000-0000-0000-0000-000000000005',
    'retry_exhausted_unknown',
    '2030-01-01T00:00:00Z',
    '2030-01-09T00:00:00Z',
    'production',
    decode(repeat('31', 16), 'hex'), decode(repeat('32', 12), 'hex'),
    decode(repeat('33', 48), 'hex'), decode(repeat('34', 12), 'hex'), 1, null
  )$$,
  '22023',
  'Invalid dead-letter item',
  'recording cannot extend original seven-day expiry'
);

select is(
  public.record_dead_letter_item(
    '5b000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    '5c000000-0000-0000-0000-000000000005',
    'coordinator_unavailable',
    '2030-02-01T00:00:00Z',
    '2030-02-08T00:00:00Z',
    'production',
    decode(repeat('41', 16), 'hex'), decode(repeat('42', 12), 'hex'),
    decode(repeat('43', 48), 'hex'), decode(repeat('44', 12), 'hex'), 1, null
  ),
  true,
  'second recoverable item is recorded for release and rotation tests'
);

select is(
  public.record_dead_letter_item(
    '5b000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    '5c000000-0000-0000-0000-000000000005',
    'retry_exhausted_unknown',
    '2030-02-01T00:00:00Z',
    '2030-02-08T00:00:00Z',
    'production',
    decode(repeat('41', 16), 'hex'), decode(repeat('42', 12), 'hex'),
    decode(repeat('43', 48), 'hex'), decode(repeat('44', 12), 'hex'), 1, null
  ),
  false,
  'duplicate DLQ delivery is a metadata no-op'
);

select is(
  (select failure_code from public.dead_letter_items
   where id = '5b000000-0000-0000-0000-000000000005'),
  'coordinator_unavailable',
  'unknown fallback cannot replace classified failure code'
);

select is(
  (select count(*) from public.audit_log
   where target_id = '5b000000-0000-0000-0000-000000000005'
     and action = 'dead_letter.recorded'),
  1::bigint,
  'duplicate DLQ delivery does not duplicate audit transition'
);

select is(
  (
    select count(*) from public.claim_dead_letter_replay(
      '5b000000-0000-0000-0000-000000000005',
      '5d000000-0000-0000-0000-000000000005'
    )
  ),
  1::bigint,
  'second item can be claimed'
);

select is(
  public.release_dead_letter_replay(
    '5b000000-0000-0000-0000-000000000005',
    '5d000000-0000-0000-0000-000000000005'
  ),
  true,
  'failed publication releases matching replay claim'
);

select is(
  (select status from public.dead_letter_items
   where id = '5b000000-0000-0000-0000-000000000005'),
  'available',
  'released replay becomes available again'
);

select results_eq(
  $$select store, key_version, row_count
    from public.kek_encryption_inventory('production')
    where store = 'dead_letter_items'$$,
  $$values ('dead_letter_items'::text, 1, 1::bigint)$$,
  'KEK inventory includes recoverable dead-letter ciphertext'
);

select is(
  public.cas_rewrap_dead_letter_data_key(
    'production',
    '5b000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    1,
    decode(repeat('43', 48), 'hex'), decode(repeat('44', 12), 'hex'),
    decode(repeat('41', 16), 'hex'), decode(repeat('42', 12), 'hex'),
    2,
    decode(repeat('45', 48), 'hex'), decode(repeat('46', 12), 'hex')
  ),
  true,
  'dead-letter compare-and-set rewraps exact encrypted tuple'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.list_dead_letter_items(integer)',
    'execute'
  ),
  'authenticated users cannot inspect recovery inventory directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_dead_letter_replay(uuid,uuid)',
    'execute'
  ),
  'authenticated users cannot claim replay ciphertext directly'
);

select ok(
  not has_table_privilege('authenticated', 'public.dead_letter_items', 'select'),
  'authenticated users cannot select dead-letter storage'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'dead_letter_items'
      and policyname = 'clients cannot access dead-letter recovery'
      and permissive = 'RESTRICTIVE'
  ),
  'dead-letter table has explicit restrictive client policy'
);

select ok(
  not has_table_privilege('anon', 'public.dead_letter_items', 'select'),
  'anonymous clients cannot select dead-letter storage'
);

select ok(
  not has_table_privilege('authenticated', 'public.dead_letter_items', 'insert'),
  'authenticated users cannot insert dead-letter storage'
);

select ok(
  not has_table_privilege('authenticated', 'public.dead_letter_items', 'update'),
  'authenticated users cannot update dead-letter storage'
);

select ok(
  not has_table_privilege('authenticated', 'public.dead_letter_items', 'delete'),
  'authenticated users cannot delete dead-letter storage'
);

select ok(
  not has_table_privilege('service_role', 'public.dead_letter_items', 'delete'),
  'backend role cannot bypass recovery state machine with direct deletion'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.record_dead_letter_item(uuid,uuid,uuid,text,timestamptz,timestamptz,text,bytea,bytea,bytea,bytea,integer,uuid)',
    'execute'
  ),
  'authenticated users cannot record dead-letter ciphertext directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.release_dead_letter_replay(uuid,uuid)',
    'execute'
  ),
  'authenticated users cannot release replay claims directly'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_dead_letter_replay(uuid,uuid,text)',
    'execute'
  ),
  'authenticated users cannot complete replay claims directly'
);

select is(
  public.purge_expired_raw_payloads('2030-02-08T00:00:01Z'),
  1::bigint,
  'retention purge destroys expired dead-letter ciphertext'
);

select ok(
  (select status = 'expired' and ciphertext is null and key_version is null
   from public.dead_letter_items
   where id = '5b000000-0000-0000-0000-000000000005'),
  'purged dead-letter metadata remains inspectable without recoverable content'
);

select is(
  public.record_dead_letter_item(
    '6a000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    '6b000000-0000-0000-0000-000000000005',
    'persistence_unavailable',
    '2030-03-01T00:00:00Z',
    '2030-03-08T00:00:00Z',
    'production',
    decode(repeat('71', 16), 'hex'), decode(repeat('72', 12), 'hex'),
    decode(repeat('73', 48), 'hex'), decode(repeat('74', 12), 'hex'), 1, null
  ),
  true,
  'race fixture records recoverable ciphertext'
);

select is(
  (
    select count(*) from public.claim_dead_letter_replay(
      '6a000000-0000-0000-0000-000000000005',
      '6c000000-0000-0000-0000-000000000005'
    )
  ),
  1::bigint,
  'race fixture enters replaying state'
);

select is(
  public.cas_rewrap_dead_letter_data_key(
    'production',
    '6a000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    1,
    decode(repeat('73', 48), 'hex'), decode(repeat('74', 12), 'hex'),
    decode(repeat('71', 16), 'hex'), decode(repeat('72', 12), 'hex'),
    2,
    decode(repeat('75', 48), 'hex'), decode(repeat('76', 12), 'hex')
  ),
  true,
  'KEK rotation may complete while replay is active'
);

select is(
  public.record_dead_letter_item(
    '6a000000-0000-0000-0000-000000000005',
    '50000000-0000-0000-0000-000000000005',
    '6b000000-0000-0000-0000-000000000005',
    'coordinator_unavailable',
    '2030-03-01T00:00:00Z',
    '2030-03-08T00:00:00Z',
    'production',
    decode(repeat('71', 16), 'hex'), decode(repeat('72', 12), 'hex'),
    decode(repeat('73', 48), 'hex'), decode(repeat('74', 12), 'hex'), 1,
    '6c000000-0000-0000-0000-000000000005'
  ),
  true,
  'failed replay records failure against matching claim after concurrent rewrap'
);

select ok(
  (select status = 'replaying'
      and replay_request_id = '6c000000-0000-0000-0000-000000000005'
      and key_version = 2
      and wrapped_data_key = decode(repeat('75', 48), 'hex')
      and wrap_nonce = decode(repeat('76', 12), 'hex')
   from public.dead_letter_items
   where id = '6a000000-0000-0000-0000-000000000005'),
  'failed replay preserves request claim and concurrently rewrapped ciphertext tuple'
);

select is(
  (
    select count(*) from public.claim_dead_letter_replay(
      '6a000000-0000-0000-0000-000000000005',
      '6c000000-0000-0000-0000-000000000005'
    )
  ),
  1::bigint,
  'same request can republish after ambiguous replay failure'
);

select * from finish();
rollback;
