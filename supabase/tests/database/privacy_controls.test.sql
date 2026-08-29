begin;

create extension if not exists pgtap with schema extensions;
select plan(31);

-- Two tenants. Tenant one carries raw payloads plus derived rows that must survive a purge; tenant
-- two exists so every tenant-scoped claim is checked against a second user rather than assumed.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '70000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'privacy-one@example.test', '', now(), now(), now()
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'privacy-two@example.test', '', now(), now(), now()
  );

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint,
  raw_ciphertext, raw_nonce, wrapped_data_key, wrap_nonce, key_version, encryption_environment
) values
  (
    '71100000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
    'email', 'privacy-one', now(), now(), repeat('a', 64),
    decode(repeat('00', 16), 'hex'), decode(repeat('01', 12), 'hex'),
    decode(repeat('02', 48), 'hex'), decode(repeat('03', 12), 'hex'), 1, 'development'
  ),
  (
    '71100000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000002',
    'email', 'privacy-two', now(), now(), repeat('b', 64),
    decode(repeat('10', 16), 'hex'), decode(repeat('11', 12), 'hex'),
    decode(repeat('12', 48), 'hex'), decode(repeat('13', 12), 'hex'), 1, 'development'
  );

insert into public.relay_events (
  id, user_id, source_item_id, kind, title, summary, confidence, provenance
) values
  (
    '71500000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
    '71100000-0000-4000-8000-000000000001', 'task', 'synthetic', 'synthetic', 0.900, '[]'::jsonb
  ),
  (
    '71500000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001',
    '71100000-0000-4000-8000-000000000001', 'task', 'synthetic two', 'synthetic', 0.900, '[]'::jsonb
  );

insert into public.categories (id, user_id, slug, name) values (
  '71900000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
  'privacy-history', 'Privacy History'
);

insert into public.classifications (
  user_id, source_item_id, category_id, method, confidence
) values (
  '70000000-0000-4000-8000-000000000001', '71100000-0000-4000-8000-000000000001',
  '71900000-0000-4000-8000-000000000001', 'deterministic', 0.900
);

insert into public.devices (id, user_id, name, platform) values
  ('71200000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'one', 'android');

insert into public.connections (
  id, user_id, provider, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce,
  encryption_environment
) values (
  '71300000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'google-tasks',
  decode(repeat('00', 16), 'hex'), decode(repeat('01', 12), 'hex'),
  decode(repeat('02', 48), 'hex'), decode(repeat('03', 12), 'hex'), 'development'
);

select public.create_gmail_connection_v1(
  '71300000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001',
  'privacy-gmail@example.test',
  decode(repeat('20', 16), 'hex'), decode(repeat('21', 12), 'hex'),
  decode(repeat('22', 48), 'hex'), decode(repeat('23', 12), 'hex'), 1, 'development',
  array['https://www.googleapis.com/auth/gmail.readonly']
);

insert into public.filter_rules (id, user_id, name, intent, plan) values
  ('71400000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
   'synthetic rule', 'synthetic intent', '{}'::jsonb);

insert into public.action_rules (
  id, user_id, filter_rule_id, connection_id, provider, operation, input_template
) values
  (
    '71600000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
    '71400000-0000-4000-8000-000000000001', '71300000-0000-4000-8000-000000000001',
    'google-tasks', 'insert', '{}'::jsonb
  ),
  (
    '71600000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001',
    '71400000-0000-4000-8000-000000000001', '71300000-0000-4000-8000-000000000002',
    'google-tasks', 'insert', '{}'::jsonb
  );

insert into public.action_runs (
  id, user_id, action_rule_id, event_id, provider, status, input, completed_at
) values
  (
    '71700000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001',
    '71600000-0000-4000-8000-000000000001', '71500000-0000-4000-8000-000000000001',
    'google-tasks', 'approved', '{}'::jsonb, null
  ),
  (
    '71700000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001',
    '71600000-0000-4000-8000-000000000001', '71500000-0000-4000-8000-000000000002',
    'google-tasks', 'succeeded', '{}'::jsonb, now()
  );

select results_eq(
  $$select connection_id from public.gmail_connection_state
    where user_id = '70000000-0000-4000-8000-000000000001'$$,
  $$values ('71300000-0000-4000-8000-000000000002'::uuid)$$,
  'reset schema composes Gmail state with privacy tenant fixtures'
);

------------------------------------------------------- tenant one, acting as an end user
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  'select retained_count from public.own_raw_retention_status()',
  'values (1::bigint)',
  'retention status counts only the calling tenant retained payloads'
);

select ok(
  (select earliest_expires_at is not null from public.own_raw_retention_status()),
  'retention status reports when the next cleanup removes the payload'
);

select results_eq(
  'select public.purge_own_raw_payloads()',
  'values (1::bigint)',
  'tenant purges its own retained payload immediately'
);

select results_eq(
  'select retained_count from public.own_raw_retention_status()',
  'values (0::bigint)',
  'nothing remains retained for the tenant after the purge'
);

select results_eq(
  'select public.purge_own_raw_payloads()',
  'values (0::bigint)',
  'purging again is a no-op rather than an error'
);

select results_eq(
  'select count(*)::bigint from public.source_items where external_id = ''privacy-one''',
  'values (1::bigint)',
  'purge keeps the source item row and its metadata'
);

select results_eq(
  'select count(*)::bigint from public.relay_events',
  'values (2::bigint)',
  'purge keeps derived events'
);

select results_eq(
  'select count(*)::bigint from public.classifications',
  'values (1::bigint)',
  'purge keeps derived classifications'
);

select ok(
  (select not exists (
    select 1 from public.audit_log
    where action = 'privacy.raw_payloads_purged'
      and metadata::text like '%ciphertext%'
  )),
  'purge audit entry records a count without content'
);

select results_eq(
  'select attempt_count from public.request_own_account_deletion()',
  'values (1)',
  'first deletion request records one attempt'
);

select results_eq(
  'select state::text from public.request_own_account_deletion()',
  'values (''requested'')',
  'repeating the request keeps the state rather than restarting it'
);

select results_eq(
  'select attempt_count from public.account_deletions',
  'values (2)',
  'repeating the request counts the retry'
);

select throws_ok(
  'select public.finalize_account_deletion(''70000000-0000-4000-8000-000000000001'')',
  '42501',
  null,
  'end user cannot finalize an account deletion'
);

select throws_ok(
  'select public.mark_account_connectors_revoked(''70000000-0000-4000-8000-000000000001'')',
  '42501',
  null,
  'end user cannot mark connectors revoked'
);

select throws_ok(
  'select public.request_account_deletion(''70000000-0000-4000-8000-000000000002'')',
  '42501',
  null,
  'end user cannot open a deletion through the service entry point'
);

------------------------------------------------------- tenant two, cross-tenant checks
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select results_eq(
  'select retained_count from public.own_raw_retention_status()',
  'values (1::bigint)',
  'second tenant retained payload is untouched by the first tenant purge'
);

select ok(
  (select raw_ciphertext is not null from public.source_items
   where external_id = 'privacy-two'),
  'second tenant ciphertext survives the first tenant purge'
);

select results_eq(
  'select count(*)::bigint from public.account_deletions',
  'values (0::bigint)',
  'second tenant cannot see the first tenant account deletion record'
);

------------------------------------------------------- service role finalization
reset role;

select results_eq(
  'select state::text from public.mark_account_connectors_revoked(''70000000-0000-4000-8000-000000000001'')',
  'values (''connectors_revoked'')',
  'service role advances state once provider revocation finished'
);

select results_eq(
  'select state::text from public.finalize_account_deletion(''70000000-0000-4000-8000-000000000001'')',
  'values (''completed'')',
  'finalization completes the deletion'
);

select results_eq(
  'select status::text from public.action_runs where id = ''71700000-0000-4000-8000-000000000001''',
  'values (''cancelled'')',
  'finalization cancels a pending action run'
);

select results_eq(
  'select status::text from public.action_runs where id = ''71700000-0000-4000-8000-000000000002''',
  'values (''succeeded'')',
  'finalization leaves an already terminal action run alone'
);

select results_eq(
  'select count(*)::bigint from public.connections where user_id = ''70000000-0000-4000-8000-000000000001''',
  'values (0::bigint)',
  'finalization removes every stored credential'
);

select results_eq(
  $$select count(*)::bigint from public.gmail_connection_state
    where user_id = '70000000-0000-4000-8000-000000000001'$$,
  'values (0::bigint)',
  'finalization cascades Gmail state with its active credential'
);

select results_eq(
  $$select enabled, connection_id from public.action_rules
    where id = '71600000-0000-4000-8000-000000000002'$$,
  $$values (false, null::uuid)$$,
  'finalization disables and detaches a rule bound to Gmail'
);

select results_eq(
  'select count(*)::bigint from public.devices where user_id = ''70000000-0000-4000-8000-000000000001'' and revoked_at is null',
  'values (0::bigint)',
  'finalization invalidates every device'
);

select results_eq(
  'select state::text from public.finalize_account_deletion(''70000000-0000-4000-8000-000000000001'')',
  'values (''completed'')',
  'finalization is idempotent when retried'
);

select throws_ok(
  'select public.finalize_account_deletion(''70000000-0000-4000-8000-000000000002'')',
  'P0002',
  null,
  'finalization refuses a tenant that never requested deletion'
);

select results_eq(
  'select state::text from public.request_account_deletion(''70000000-0000-4000-8000-000000000002'')',
  'values (''requested'')',
  'service role can open a deletion for an already authenticated tenant'
);

-- Criterion: account deletion deletes tenant rows. Removing the identity is what the API does
-- last, and every tenant table references auth.users on delete cascade, so this proves the claim
-- rather than trusting the foreign keys by inspection.
insert into public.gmail_disconnect_receipts (
  connection_id, user_id, action_id, reason, watch_stopped, token_revoked,
  provider_already_revoked, detached_action_rule_count
) values (
  '71300000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001',
  '71800000-0000-4000-8000-000000000001', 'user-disconnect', true, true, false, 1
);
insert into public.gmail_disconnect_tombstones (
  mailbox_digest, connection_id, user_id, expires_at
) values (
  repeat('c', 64), '71300000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000001', now() + interval '1 day'
);
insert into public.gmail_terminal_message_receipts (
  connection_id, user_id, message_digest, reason
) values (
  '71300000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000001',
  repeat('d', 64), 'provider-message-missing'
);
delete from auth.users where id = '70000000-0000-4000-8000-000000000001';

select results_eq(
  $$select (
      (select count(*) from public.profiles where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.devices where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.connections where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.source_items where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.categories where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.classifications where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.filter_rules where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.relay_events where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.action_rules where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.action_runs where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.ai_disclosures where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.audit_log where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.source_facts where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.dead_letter_items where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.account_deletions where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.gmail_connection_state where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.gmail_disconnect_receipts where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.gmail_disconnect_tombstones where user_id = '70000000-0000-4000-8000-000000000001') +
      (select count(*) from public.gmail_terminal_message_receipts where user_id = '70000000-0000-4000-8000-000000000001')
    )::bigint$$,
  'values (0::bigint)',
  'removing the identity cascades every tenant row away'
);

select * from finish();
rollback;
