begin;

create extension if not exists pgtap with schema extensions;
select plan(68);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '81000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'gmail-one@example.test', '', now(), now(), now()
  ),
  (
    '82000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'gmail-two@example.test', '', now(), now(), now()
  );

select is(
  public.create_gmail_connection_v1(
    '81100000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'shared@example.test',
    decode(repeat('11', 16), 'hex'), decode(repeat('12', 12), 'hex'),
    decode(repeat('13', 48), 'hex'), decode(repeat('14', 12), 'hex'), 1, 'production',
    array['https://www.googleapis.com/auth/gmail.readonly']
  ),
  '81100000-0000-0000-0000-000000000001'::uuid,
  'connector and initial Gmail state are created atomically'
);

select throws_ok(
  $$select public.create_gmail_connection_v1(
    '82200000-0000-0000-0000-000000000002',
    '82000000-0000-0000-0000-000000000002',
    'shared@example.test',
    decode(repeat('21', 16), 'hex'), decode(repeat('22', 12), 'hex'),
    decode(repeat('23', 48), 'hex'), decode(repeat('24', 12), 'hex'), 1, 'production',
    array['https://www.googleapis.com/auth/gmail.readonly']
  )$$,
  '23505', null,
  'active Gmail mailbox ownership is globally unique across tenants'
);

select throws_ok(
  $$select public.create_gmail_connection_v1(
    '82300000-0000-0000-0000-000000000003',
    '82000000-0000-0000-0000-000000000002',
    'other@example.test',
    decode(repeat('31', 16), 'hex'), decode(repeat('32', 12), 'hex'),
    decode(repeat('33', 48), 'hex'), decode(repeat('34', 12), 'hex'), 1, 'production',
    array['openid']
  )$$,
  '22023', 'Invalid Gmail connection',
  'connector creation requires granted Gmail readonly scope'
);

select results_eq(
  $$select user_id, connection_id, target_status
    from public.resolve_gmail_connection_v1('shared@example.test')$$,
  $$values (
    '81000000-0000-0000-0000-000000000001'::uuid,
    '81100000-0000-0000-0000-000000000001'::uuid,
    'active'::text
  )$$,
  'normalized mailbox resolves to one tenant-owned connector'
);

select is_empty(
  $$select * from public.resolve_gmail_connection_v1('unknown@example.test')$$,
  'unknown mailbox has no fallback tenant'
);

select is_empty(
  $$select * from public.load_gmail_connection_v1(
    '82000000-0000-0000-0000-000000000002',
    '81100000-0000-0000-0000-000000000001'
  )$$,
  'credential load requires matching user and connection'
);

select is(
  public.gmail_connection_ownership_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001'
  ), 'active',
  'disconnect ownership check accepts matching tenant and connection'
);

select is(
  public.gmail_connection_ownership_v1(
    '82000000-0000-0000-0000-000000000002',
    '81100000-0000-0000-0000-000000000001'
  ), 'absent',
  'disconnect ownership check rejects cross-tenant connection ID'
);

select ok(
  public.set_gmail_history_baseline_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    '90071992547409931234'
  ),
  'initial watch baseline preserves decimal History ID'
);

select ok(
  public.set_gmail_history_baseline_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    '90071992547409931234'
  ),
  'lost initial baseline response retry is idempotent'
);

select ok(
  public.advance_gmail_history_cursor_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    '90071992547409931234', '90071992547409931235'
  ),
  'cursor advances with expected ownership and predecessor'
);

select ok(
  public.advance_gmail_history_cursor_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    '90071992547409931234', '90071992547409931235'
  ),
  'lost cursor response retry is idempotent'
);

select is(
  public.persist_encrypted_source_item_v4(
    '81300000-0000-0000-0000-000000000003',
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    'gmail', '81100000-0000-0000-0000-000000000001', 'message-1', null,
    now(), now(), repeat('a', 64), repeat('b', 64), now(), now() + interval '7 days',
    'production', decode(repeat('41', 16), 'hex'), decode(repeat('42', 12), 'hex'),
    decode(repeat('43', 48), 'hex'), decode(repeat('44', 12), 'hex'), 1
  ),
  'stored',
  'Gmail persistence stores encrypted source through connection-bound v4 RPC'
);

select is(
  (select connection_id from public.source_items where id = '81300000-0000-0000-0000-000000000003'),
  '81100000-0000-0000-0000-000000000001'::uuid,
  'Gmail source row remains bound to connector'
);

select is(
  public.persist_encrypted_source_item_v4(
    '82400000-0000-0000-0000-000000000004',
    '82000000-0000-0000-0000-000000000002',
    '81100000-0000-0000-0000-000000000001',
    'gmail', '81100000-0000-0000-0000-000000000001', 'message-2', null,
    now(), now(), repeat('c', 64), repeat('d', 64), now(), now() + interval '7 days',
    'production', decode(repeat('51', 16), 'hex'), decode(repeat('52', 12), 'hex'),
    decode(repeat('53', 48), 'hex'), decode(repeat('54', 12), 'hex'), 1
  ),
  'tenant-conflict',
  'Gmail source persistence fails closed on tenant-connection mismatch'
);

do $$
declare
  ordinal integer;
begin
  for ordinal in 1..51 loop
    perform public.create_gmail_connection_v1(
      ('83000000-0000-0000-0000-' || lpad(ordinal::text, 12, '0'))::uuid,
      '82000000-0000-0000-0000-000000000002',
      'stale-' || ordinal::text || '@example.test',
      decode(repeat('61', 16), 'hex'), decode(repeat('62', 12), 'hex'),
      decode(repeat('63', 48), 'hex'), decode(repeat('64', 12), 'hex'), 1, 'production',
      array['https://www.googleapis.com/auth/gmail.readonly']
    );
  end loop;
end;
$$;

update public.gmail_connection_state
set sync_status = 'stale', error_code = 'stale-history'
where normalized_email like 'stale-%@example.test';

do $$
begin
  perform public.create_gmail_connection_v1(
    '83900000-0000-0000-0000-000000000999',
    '82000000-0000-0000-0000-000000000002',
    'active-due@example.test',
    decode(repeat('71', 16), 'hex'), decode(repeat('72', 12), 'hex'),
    decode(repeat('73', 48), 'hex'), decode(repeat('74', 12), 'hex'), 1, 'production',
    array['https://www.googleapis.com/auth/gmail.readonly']
  );
end;
$$;

select results_eq(
  $$select connection_id from public.list_due_gmail_connections_v1(50)
    where connection_id = '83900000-0000-0000-0000-000000000999'::uuid$$,
  $$values ('83900000-0000-0000-0000-000000000999'::uuid)$$,
  'active due connection is not starved by more than fifty stale rows'
);

select is(
  (
    select count(*)
    from public.list_due_gmail_connections_v1(50) as due
    join public.gmail_connection_state as state using (connection_id, user_id)
    where state.sync_status = 'stale'
  ),
  0::bigint,
  'maintenance excludes stale Gmail state before applying limit'
);

select ok(
  public.mark_gmail_resync_required_v1(
    '82000000-0000-0000-0000-000000000002',
    '83900000-0000-0000-0000-000000000999',
    'initialization-ambiguous'
  ),
  'explicit resync reason marks owned active connector stale'
);

select is(
  (
    select error_code from public.gmail_connection_state
    where connection_id = '83900000-0000-0000-0000-000000000999'
  ),
  'initialization-ambiguous',
  'resync state preserves fixed initialization failure reason'
);

update public.gmail_connection_state
set watch_renewal_due_at = now() + interval '1 day',
    reconciliation_due_at = now() + interval '1 day'
where sync_status = 'active';

do $$
declare
  ordinal integer;
begin
  for ordinal in 1..51 loop
    perform public.create_gmail_connection_v1(
      ('84000000-0000-0000-0000-' || lpad(ordinal::text, 12, '0'))::uuid,
      '82000000-0000-0000-0000-000000000002',
      'failing-' || ordinal::text || '@example.test',
      decode(repeat('91', 16), 'hex'), decode(repeat('92', 12), 'hex'),
      decode(repeat('93', 48), 'hex'), decode(repeat('94', 12), 'hex'), 1, 'production',
      array['https://www.googleapis.com/auth/gmail.readonly']
    );
  end loop;
end;
$$;

create temporary table first_gmail_claim as
select * from public.list_due_gmail_connections_v1(50);
create temporary table second_gmail_claim as
select * from public.list_due_gmail_connections_v1(50);

select is(
  (select count(*) from first_gmail_claim),
  50::bigint,
  'first maintenance claim leases bounded active failures'
);

select is(
  (select count(*) from second_gmail_claim),
  1::bigint,
  'leased active failures cannot monopolize next claim batch'
);

select is(
  (
    select count(*) from first_gmail_claim as first_claim
    join second_gmail_claim as second_claim using (connection_id, user_id)
  ),
  0::bigint,
  'atomic claims do not return an active connection twice before lease expiry'
);

update public.gmail_connection_state as state
set watch_renewal_due_at = now() - interval '1 second',
    reconciliation_due_at = now() - interval '1 second'
from first_gmail_claim as claimed
where state.user_id = claimed.user_id and state.connection_id = claimed.connection_id;

select results_eq(
  $$select connection_id from public.list_due_gmail_connections_v1(50) order by connection_id$$,
  $$select connection_id from first_gmail_claim order by connection_id$$,
  'failed scheduling becomes eligible after finite lease expiry'
);

select ok(
  public.record_gmail_terminal_message_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    repeat('d', 64),
    'provider-response-too-large'
  ),
  'deterministic Gmail message failure stores terminal receipt'
);

select ok(
  public.record_gmail_terminal_message_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    repeat('d', 64),
    'provider-response-too-large'
  ),
  'lost terminal receipt response retry is idempotent'
);

select is(
  (
    select count(*) from public.gmail_terminal_message_receipts
    where connection_id = '81100000-0000-0000-0000-000000000001'
      and message_digest = repeat('d', 64)
  ),
  1::bigint,
  'terminal message receipt is unique by connection and digest'
);

select is(
  (
    select expires_at - completed_at from public.gmail_terminal_message_receipts
    where connection_id = '81100000-0000-0000-0000-000000000001'
      and message_digest = repeat('d', 64)
  ),
  interval '7 days',
  'terminal message receipt has explicit bounded lifetime'
);

select results_eq(
  $$select metadata from public.audit_log
    where action = 'gmail.message.terminal'
      and target_id = '81100000-0000-0000-0000-000000000001'$$,
  $$values (jsonb_build_object(
    'messageDigest', repeat('d', 64),
    'reason', 'provider-response-too-large'
  ))$$,
  'terminal message retry writes one metadata-only audit record'
);

select ok(
  not public.record_gmail_terminal_message_v1(
    '82000000-0000-0000-0000-000000000002',
    '81100000-0000-0000-0000-000000000001',
    repeat('e', 64),
    'provider-response-invalid'
  ),
  'cross-tenant terminal message receipt is denied'
);

do $$
begin
  perform public.purge_expired_raw_payloads(
    (select expires_at - interval '1 second'
     from public.gmail_terminal_message_receipts
     where connection_id = '81100000-0000-0000-0000-000000000001'
       and message_digest = repeat('d', 64))
  );
end;
$$;

select is(
  (
    select count(*) from public.gmail_terminal_message_receipts
    where connection_id = '81100000-0000-0000-0000-000000000001'
      and message_digest = repeat('d', 64)
  ),
  1::bigint,
  'terminal receipt remains available before expiry for idempotent retry'
);

do $$
begin
  perform public.purge_expired_raw_payloads(
    (select expires_at
     from public.gmail_terminal_message_receipts
     where connection_id = '81100000-0000-0000-0000-000000000001'
       and message_digest = repeat('d', 64))
  );
end;
$$;

select is(
  (
    select count(*) from public.gmail_terminal_message_receipts
    where connection_id = '81100000-0000-0000-0000-000000000001'
      and message_digest = repeat('d', 64)
  ),
  0::bigint,
  'terminal receipt is purged at expiry'
);

select ok(
  public.record_gmail_watch_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    '90071992547409931236',
    now() + interval '7 days 5 minutes'
  ),
  'watch expiration accepts documented maximum plus clock tolerance'
);

select throws_ok(
  $$select public.record_gmail_watch_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    '90071992547409931237',
    now() + interval '7 days 5 minutes 1 second'
  )$$,
  '22023', 'Invalid Gmail watch',
  'direct RPC rejects watch expiration beyond provider maximum and tolerance'
);

create temporary table expected_gmail_tombstone_expiry as
select watch_expiration + interval '7 days' as expires_at
from public.gmail_connection_state
where connection_id = '81100000-0000-0000-0000-000000000001';

insert into public.filter_rules (id, user_id, name, intent, plan) values
  (
    '81700000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    'Synthetic Gmail detach one', 'test Gmail detach', '{"deterministic":[]}'
  ),
  (
    '82700000-0000-0000-0000-000000000002',
    '82000000-0000-0000-0000-000000000002',
    'Synthetic Gmail detach two', 'test Gmail isolation', '{"deterministic":[]}'
  );

insert into public.action_rules (
  id, user_id, filter_rule_id, connection_id, provider, operation, input_template, updated_at
) values
  (
    '81800000-0000-0000-0000-000000000001',
    '81000000-0000-0000-0000-000000000001',
    '81700000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    'google-tasks', 'create', '{}', now() - interval '1 day'
  ),
  (
    '82800000-0000-0000-0000-000000000002',
    '82000000-0000-0000-0000-000000000002',
    '82700000-0000-0000-0000-000000000002',
    '83900000-0000-0000-0000-000000000999',
    'google-tasks', 'create', '{}', now() - interval '1 day'
  );

select ok(
  not public.disconnect_gmail_connection_v1(
    '82000000-0000-0000-0000-000000000002',
    '81100000-0000-0000-0000-000000000001',
    '82600000-0000-0000-0000-000000000002',
    'user-disconnect',
    true, true, false, 604800
  ),
  'cross-user completion cannot detach rules or delete Gmail credential'
);

select ok(
  public.disconnect_gmail_connection_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    '81600000-0000-0000-0000-000000000001',
    'user-disconnect',
    true, true, false, 604800
  ),
  'provider-completed Gmail disconnect deletes owned credential'
);

select ok(
  public.disconnect_gmail_connection_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001',
    '81600000-0000-0000-0000-000000000001',
    'user-disconnect',
    true, true, false, 604800
  ),
  'lost Gmail disconnect response retry is idempotent'
);

select is_empty(
  $$select * from public.connections
    where id = '81100000-0000-0000-0000-000000000001'::uuid$$,
  'disconnect removes encrypted connector credential only after provider phases'
);

select results_eq(
  $$select enabled, connection_id, updated_at = now()
    from public.action_rules
    where id = '81800000-0000-0000-0000-000000000001'::uuid$$,
  $$values (false, null::uuid, true)$$,
  'atomic disconnect disables and detaches referenced action rule for inspection'
);

select results_eq(
  $$select enabled, connection_id
    from public.action_rules
    where id = '82800000-0000-0000-0000-000000000002'::uuid$$,
  $$values (true, '83900000-0000-0000-0000-000000000999'::uuid)$$,
  'disconnect leaves cross-user action rule and connection unchanged'
);

select is(
  (
    select count(*) from public.gmail_disconnect_receipts
    where connection_id = '81100000-0000-0000-0000-000000000001'::uuid
  ),
  1::bigint,
  'disconnect receipt permanently arbitrates retries'
);

select is(
  (
    select count(*) from public.audit_log
    where action = 'connector.disconnected'
      and target_id = '81100000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'disconnect retry writes one metadata-only audit record'
);

select results_eq(
  $$select action_id, reason, watch_stopped, token_revoked, provider_already_revoked,
      detached_action_rule_count
    from public.gmail_disconnect_receipts
    where connection_id = '81100000-0000-0000-0000-000000000001'::uuid$$,
  $$values (
    '81600000-0000-0000-0000-000000000001'::uuid,
    'user-disconnect'::text, true, true, false, 1
  )$$,
  'disconnect receipt preserves exact provider completion evidence'
);

select is(
  public.gmail_connection_ownership_v1(
    '81000000-0000-0000-0000-000000000001',
    '81100000-0000-0000-0000-000000000001'
  ),
  'completed',
  'same tenant retry resolves completed receipt after active connection deletion'
);

select is(
  public.gmail_connection_ownership_v1(
    '82000000-0000-0000-0000-000000000002',
    '81100000-0000-0000-0000-000000000001'
  ),
  'absent',
  'completed receipt does not leak across tenants'
);

select is(
  public.gmail_connection_ownership_v1(
    '81000000-0000-0000-0000-000000000001',
    '81900000-0000-0000-0000-000000000999'
  ),
  'absent',
  'random connection ID remains absent'
);

select results_eq(
  $$select user_id, connection_id, target_status
    from public.resolve_gmail_connection_v1('shared@example.test')$$,
  $$values (
    '81000000-0000-0000-0000-000000000001'::uuid,
    '81100000-0000-0000-0000-000000000001'::uuid,
    'tombstone'::text
  )$$,
  'late push resolves short-lived non-routing disconnect tombstone'
);

select is(
  (
    select expires_at from public.gmail_disconnect_tombstones
    where connection_id = '81100000-0000-0000-0000-000000000001'
  ),
  (select expires_at from expected_gmail_tombstone_expiry),
  'late-push tombstone covers saved watch expiration plus configured Pub/Sub retention'
);

select is(
  public.create_gmail_connection_v1(
    '82500000-0000-0000-0000-000000000005',
    '82000000-0000-0000-0000-000000000002',
    'shared@example.test',
    decode(repeat('b1', 16), 'hex'), decode(repeat('b2', 12), 'hex'),
    decode(repeat('b3', 48), 'hex'), decode(repeat('b4', 12), 'hex'), 1, 'production',
    array['https://www.googleapis.com/auth/gmail.readonly']
  ),
  '82500000-0000-0000-0000-000000000005'::uuid,
  'mailbox can be reconnected only after old active connection deletion'
);

select results_eq(
  $$select user_id, connection_id, target_status
    from public.resolve_gmail_connection_v1('shared@example.test')$$,
  $$values (
    '82000000-0000-0000-0000-000000000002'::uuid,
    '82500000-0000-0000-0000-000000000005'::uuid,
    'active'::text
  )$$,
  'active connection takes precedence over old disconnect tombstone'
);

delete from public.connections
where id = '82500000-0000-0000-0000-000000000005'::uuid;
update public.gmail_disconnect_tombstones
set completed_at = now() - interval '2 days',
    expires_at = now() - interval '1 day'
where connection_id = '81100000-0000-0000-0000-000000000001'::uuid;

select is_empty(
  $$select * from public.resolve_gmail_connection_v1('shared@example.test')$$,
  'expired tombstone no longer acknowledges late push'
);

select is(
  (
    select count(*) from public.gmail_disconnect_tombstones
    where connection_id = '81100000-0000-0000-0000-000000000001'::uuid
  ),
  0::bigint,
  'expired tombstone is purged during lookup'
);

do $$
begin
  perform public.create_gmail_connection_v1(
    '81500000-0000-0000-0000-000000000005',
    '81000000-0000-0000-0000-000000000001',
    'already-revoked@example.test',
    decode(repeat('f1', 16), 'hex'), decode(repeat('f2', 12), 'hex'),
    decode(repeat('f3', 48), 'hex'), decode(repeat('f4', 12), 'hex'), 1, 'production',
    array['https://www.googleapis.com/auth/gmail.readonly']
  );
  insert into public.action_rules (
    id, user_id, filter_rule_id, connection_id, provider, operation, input_template,
    updated_at
  ) values (
    '81800000-0000-0000-0000-000000000005',
    '81000000-0000-0000-0000-000000000001',
    '81700000-0000-0000-0000-000000000001',
    '81500000-0000-0000-0000-000000000005',
    'google-tasks', 'create', '{}', now() - interval '1 day'
  );
end;
$$;

select ok(
  public.disconnect_gmail_connection_v1(
    '81000000-0000-0000-0000-000000000001',
    '81500000-0000-0000-0000-000000000005',
    '81600000-0000-0000-0000-000000000005',
    'provider-grant-revoked',
    false, true, true, 604800
  ),
  'already-revoked provider grant completes local disconnect'
);

select results_eq(
  $$select action_id, reason, watch_stopped, token_revoked, provider_already_revoked,
      detached_action_rule_count
    from public.gmail_disconnect_receipts
    where connection_id = '81500000-0000-0000-0000-000000000005'::uuid$$,
  $$values (
    '81600000-0000-0000-0000-000000000005'::uuid,
    'provider-grant-revoked'::text, false, true, true, 1
  )$$,
  'already-revoked receipt marks watch stop unavailable without claiming success'
);

select results_eq(
  $$select enabled, connection_id
    from public.action_rules
    where id = '81800000-0000-0000-0000-000000000005'::uuid$$,
  $$values (false, null::uuid)$$,
  'automatic revoked cleanup disables and detaches dependent action rule'
);

select results_eq(
  $$select metadata from public.audit_log
    where action = 'connector.revoked'
      and target_id = '81500000-0000-0000-0000-000000000005'$$,
  $$values ('{
    "actionId":"81600000-0000-0000-0000-000000000005",
    "detachedActionRuleCount":1,
    "provider":"gmail",
    "providerAlreadyRevoked":true,
    "reason":"provider-grant-revoked",
    "tokenRevoked":true,
    "watchStopped":false
  }'::jsonb)$$,
  'disconnect audit preserves metadata-only already-revoked evidence'
);

select lives_ok(
  $$insert into public.connections (
      id, user_id, provider, external_account_id, credential_ciphertext, credential_nonce,
      wrapped_data_key, wrap_nonce, key_version, scopes, status, encryption_environment
    ) values (
      '82900000-0000-0000-0000-000000000997',
      '82000000-0000-0000-0000-000000000002', 'gmail', 'legacy malformed mailbox',
      decode(repeat('a1', 16), 'hex'), decode(repeat('a2', 12), 'hex'),
      decode(repeat('a3', 48), 'hex'), decode(repeat('a4', 12), 'hex'), 1, '{}', 'revoked',
      'production'
    );
    update public.connections set metadata = '{"checked":true}'::jsonb
    where id = '82900000-0000-0000-0000-000000000997'::uuid$$,
  'inactive legacy Gmail rows are outside active mailbox validity constraint'
);

do $$
begin
  perform public.create_gmail_connection_v1(
    '82600000-0000-0000-0000-000000000006',
    '81000000-0000-0000-0000-000000000001',
    'direct-delete-own@example.test',
    decode(repeat('c1', 16), 'hex'), decode(repeat('c2', 12), 'hex'),
    decode(repeat('c3', 48), 'hex'), decode(repeat('c4', 12), 'hex'), 1, 'production',
    array['https://www.googleapis.com/auth/gmail.readonly']
  );
  perform public.create_gmail_connection_v1(
    '82700000-0000-0000-0000-000000000007',
    '82000000-0000-0000-0000-000000000002',
    'direct-delete-cross@example.test',
    decode(repeat('d1', 16), 'hex'), decode(repeat('d2', 12), 'hex'),
    decode(repeat('d3', 48), 'hex'), decode(repeat('d4', 12), 'hex'), 1, 'production',
    array['https://www.googleapis.com/auth/gmail.readonly']
  );
end;
$$;
insert into public.connections (
  id, user_id, provider, external_account_id, credential_ciphertext, credential_nonce,
  wrapped_data_key, wrap_nonce, key_version, scopes, status, encryption_environment
) values (
  '82800000-0000-0000-0000-000000000008',
  '81000000-0000-0000-0000-000000000001', 'gmail', 'revoked-delete@example.test',
  decode(repeat('e1', 16), 'hex'), decode(repeat('e2', 12), 'hex'),
  decode(repeat('e3', 48), 'hex'), decode(repeat('e4', 12), 'hex'), 1, '{}', 'revoked',
  'production'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select is_empty(
  $$delete from public.connections
    where id = '82600000-0000-0000-0000-000000000006'::uuid returning id$$,
  'same-user direct delete cannot bypass active Gmail provider cleanup'
);

select is_empty(
  $$delete from public.connections
    where id = '82700000-0000-0000-0000-000000000007'::uuid returning id$$,
  'cross-user direct delete cannot remove active Gmail connection'
);

select results_eq(
  $$delete from public.connections
    where id = '82800000-0000-0000-0000-000000000008'::uuid returning id$$,
  $$values ('82800000-0000-0000-0000-000000000008'::uuid)$$,
  'same-user direct delete remains available for revoked Gmail connection'
);

select throws_ok(
  $$select * from public.gmail_connection_state$$,
  '42501', null,
  'authenticated tenant has no access to service-managed Gmail cursor state'
);

select throws_ok(
  $$select * from public.gmail_disconnect_receipts$$,
  '42501', null,
  'authenticated tenant has no direct access to disconnect receipts'
);

select throws_ok(
  $$select * from public.gmail_disconnect_tombstones$$,
  '42501', null,
  'authenticated tenant has no direct access to mailbox tombstones'
);

select throws_ok(
  $$select * from public.gmail_terminal_message_receipts$$,
  '42501', null,
  'authenticated tenant has no direct access to terminal message receipts'
);

select ok(
  not has_function_privilege('authenticated', 'public.resolve_gmail_connection_v1(text)', 'execute'),
  'authenticated users cannot resolve mailbox ownership'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.persist_encrypted_source_item_v4(uuid,uuid,uuid,public.source_kind,text,text,text,timestamptz,timestamptz,text,text,timestamptz,timestamptz,text,bytea,bytea,bytea,bytea,integer)',
    'execute'
  ),
  'authenticated users cannot invoke connection-bound source persistence'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.disconnect_gmail_connection_v1(uuid,uuid,uuid,text,boolean,boolean,boolean,integer)',
    'execute'
  ),
  'authenticated users cannot bypass provider stop before disconnect persistence'
);

select ok(
  not has_function_privilege(
    'authenticated', 'public.gmail_connection_ownership_v1(uuid,uuid)', 'execute'
  ),
  'authenticated users cannot probe Gmail connection ownership directly'
);

select ok(
  not has_function_privilege(
    'authenticated', 'public.record_gmail_terminal_message_v1(uuid,uuid,text,text)', 'execute'
  ),
  'authenticated users cannot forge terminal Gmail message receipts'
);

select * from finish();
rollback;
