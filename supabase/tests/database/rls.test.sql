begin;

create extension if not exists pgtap with schema extensions;
select plan(40);

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

insert into public.devices (id, user_id, name, platform) values
  (
    '10100000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Synthetic one', 'android'
  ),
  (
    '20200000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'Synthetic two', 'android'
  ),
  (
    '20400000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000002',
    'Synthetic two alternate', 'ios'
  );

insert into public.connections (
  id, user_id, provider, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce,
  encryption_environment
) values
  (
    '11000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'synthetic', decode('00', 'hex'), decode('01', 'hex'), decode('02', 'hex'), decode('03', 'hex'),
    'development'
  ),
  (
    '22000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'synthetic', decode('10', 'hex'), decode('11', 'hex'), decode('12', 'hex'), decode('13', 'hex'),
    'development'
  );

insert into public.source_items (
  id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint
) values
  (
    '11100000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'email', 'synthetic-one', now(), now(), 'fingerprint-one'
  ),
  (
    '22200000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'email', 'synthetic-two', now(), now(), 'fingerprint-two'
  );

insert into public.classifications (id, user_id, source_item_id, method, confidence) values
  (
    '11110000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '11100000-0000-0000-0000-000000000001',
    'manual', 1
  ),
  (
    '22220000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '22200000-0000-0000-0000-000000000002',
    'manual', 1
  );

insert into public.filter_rules (id, user_id, name, intent, plan) values
  (
    '12000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Synthetic one', 'test isolation',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"test isolation"}'
  ),
  (
    '23000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    'Synthetic two', 'test isolation',
    '{"schemaVersion":1,"compilerVersion":1,"intent":"test isolation"}'
  );

insert into public.relay_events (
  id, user_id, source_item_id, kind, title, summary, confidence, provenance
) values
  (
    '13000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '11100000-0000-0000-0000-000000000001',
    'fact', 'Synthetic one', 'Synthetic event', 1, '{}'
  ),
  (
    '24000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '22200000-0000-0000-0000-000000000002',
    'fact', 'Synthetic two', 'Synthetic event', 1, '{}'
  );

insert into public.action_rules (
  id, user_id, filter_rule_id, provider, operation, input_template
) values
  (
    '14000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '12000000-0000-0000-0000-000000000001',
    'google-tasks', 'create', '{}'
  ),
  (
    '25000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '23000000-0000-0000-0000-000000000002',
    'google-tasks', 'create', '{}'
  );

-- Action run identity is derived from the rule/event pair and enforced by a check constraint, so
-- these ids are computed rather than chosen.
insert into public.action_runs (
  id, user_id, action_rule_id, event_id, provider, status, input
) values
  (
    public.relay_action_run_id('14000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001'),
    '10000000-0000-0000-0000-000000000001',
    '14000000-0000-0000-0000-000000000001',
    '13000000-0000-0000-0000-000000000001',
    'google-tasks', 'awaiting-approval', '{}'
  ),
  (
    public.relay_action_run_id('25000000-0000-0000-0000-000000000002', '24000000-0000-0000-0000-000000000002'),
    '20000000-0000-0000-0000-000000000002',
    '25000000-0000-0000-0000-000000000002',
    '24000000-0000-0000-0000-000000000002',
    'google-tasks', 'awaiting-approval', '{}'
  );

insert into public.ai_disclosures (
  id, user_id, source_item_id, model, disclosed_fields, purpose
) values
  (
    '16000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '11100000-0000-0000-0000-000000000001',
    'synthetic-model', array['subject'], 'test isolation'
  ),
  (
    '27000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '22200000-0000-0000-0000-000000000002',
    'synthetic-model', array['subject'], 'test isolation'
  );

insert into public.audit_log (user_id, actor_type, action, target_type) values
  ('10000000-0000-0000-0000-000000000001', 'system', 'synthetic.test', 'fixture'),
  ('20000000-0000-0000-0000-000000000002', 'system', 'synthetic.test', 'fixture');

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

select results_eq(
  'select id from public.devices order by id',
  $$values ('10100000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own devices'
);

select results_eq(
  'select id from public.connections order by id',
  $$values ('11000000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own connections'
);

select results_eq(
  'select id from public.source_items order by id',
  $$values ('11100000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own source items'
);

select results_eq(
  'select id from public.classifications order by id',
  $$values ('11110000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own classifications'
);

select results_eq(
  'select id from public.filter_rules order by id',
  $$values ('12000000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own filter rules'
);

select results_eq(
  'select id from public.relay_events order by id',
  $$values ('13000000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own events'
);

select results_eq(
  'select id from public.action_rules order by id',
  $$values ('14000000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own action rules'
);

select results_eq(
  'select id from public.action_runs order by id',
  $$values (public.relay_action_run_id('14000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001'))$$,
  'user sees only own action runs'
);

select results_eq(
  'select id from public.ai_disclosures order by id',
  $$values ('16000000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own AI disclosures'
);

select results_eq(
  'select user_id from public.audit_log order by id',
  $$values ('10000000-0000-0000-0000-000000000001'::uuid)$$,
  'user sees only own audit rows'
);

select lives_ok(
  $$select public.register_device('30300000-0000-0000-0000-000000000003', 'android')$$,
  'user can register own installation'
);

select throws_ok(
  $$insert into public.devices (user_id, name, platform)
    values ('10000000-0000-0000-0000-000000000001', 'Direct write', 'android')$$,
  '42501',
  null,
  'user cannot bypass device registration RPC'
);

select lives_ok(
  $$select public.register_device('30300000-0000-0000-0000-000000000003', 'android')$$,
  'repeated installation registration is idempotent'
);

select results_eq(
  $$select count(*)::bigint from public.devices
    where id = '30300000-0000-0000-0000-000000000003'$$,
  'values (1::bigint)',
  'idempotent registration creates one row'
);

select lives_ok(
  $$select public.register_device('20200000-0000-0000-0000-000000000002', 'android')$$,
  'same installation identifier remains tenant scoped'
);

select is(
  public.authorize_device_ingress('30300000-0000-0000-0000-000000000003'),
  true,
  'active installation is authorized'
);

select ok(
  (select last_seen_at is not null from public.devices
    where id = '30300000-0000-0000-0000-000000000003'),
  'authorization records metadata-only last seen timestamp'
);

select lives_ok(
  $$select public.revoke_device('30300000-0000-0000-0000-000000000003')$$,
  'user can revoke own installation'
);

select is(
  public.authorize_device_ingress('30300000-0000-0000-0000-000000000003'),
  false,
  'revoked installation is rejected'
);

select throws_ok(
  $$select public.register_device('30300000-0000-0000-0000-000000000003', 'android')$$,
  'P0002',
  'Device is unavailable',
  'registration cannot reactivate revoked installation'
);

select throws_ok(
  $$select public.revoke_device('20400000-0000-0000-0000-000000000004')$$,
  'P0002',
  'Device is unavailable',
  'user cannot revoke another tenant installation'
);

select results_eq(
  $$with changed as (
      update public.profiles
      set display_name = 'Blocked cross-tenant update'
      where user_id = '20000000-0000-0000-0000-000000000002'
      returning 1
    )
    select count(*)::bigint from changed$$,
  'values (0::bigint)',
  'user cannot update another tenant profile'
);

select results_eq(
  $$with removed as (
      delete from public.connections
      where id = '22000000-0000-0000-0000-000000000002'
      returning 1
    )
    select count(*)::bigint from removed$$,
  'values (0::bigint)',
  'user cannot delete another tenant connection'
);

select results_eq(
  $$with removed as (
      delete from public.connections
      where id = '11000000-0000-0000-0000-000000000001'
      returning 1
    )
    select count(*)::bigint from removed$$,
  'values (1::bigint)',
  'user can delete own connection'
);

select results_eq(
  $$with changed as (
      update public.categories
      set name = 'Blocked cross-tenant update'
      where user_id = '20000000-0000-0000-0000-000000000002' and slug = 'transaction'
      returning 1
    )
    select count(*)::bigint from changed$$,
  'values (0::bigint)',
  'user cannot update another tenant category'
);

select throws_ok(
  $$update public.filter_rules
    set enabled = false
    where id = '23000000-0000-0000-0000-000000000002'$$,
  '42501',
  null,
  'user cannot directly update compiled filter revisions'
);

select results_eq(
  $$with changed as (
      update public.action_rules
      set enabled = false
      where id = '25000000-0000-0000-0000-000000000002'
      returning 1
    )
    select count(*)::bigint from changed$$,
  'values (0::bigint)',
  'user cannot update another tenant action rule'
);

select throws_ok(
  $$insert into public.connections (
      id, user_id, provider, credential_ciphertext, credential_nonce, wrapped_data_key, wrap_nonce,
      encryption_environment
    ) values (
      '17000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'blocked', decode('00', 'hex'), decode('01', 'hex'), decode('02', 'hex'), decode('03', 'hex'),
      'development'
    )$$,
  '42501',
  null,
  'client cannot insert connections directly'
);

select throws_ok(
  $$insert into public.source_items (
      id, user_id, source, external_id, occurred_at, captured_at, content_fingerprint
    ) values (
      '17100000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      'email', 'blocked', now(), now(), 'blocked-source'
    )$$,
  '42501',
  null,
  'client cannot insert source items directly'
);

select throws_ok(
  $$insert into public.classifications (
      id, user_id, source_item_id, method, confidence
    ) values (
      '17200000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '11100000-0000-0000-0000-000000000001',
      'manual', 1
    )$$,
  '42501',
  null,
  'client cannot insert classifications directly'
);

select throws_ok(
  $$insert into public.relay_events (
      id, user_id, source_item_id, kind, title, summary, confidence, provenance
    ) values (
      '17300000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '11100000-0000-0000-0000-000000000001',
      'fact', 'Blocked', 'Blocked direct write', 1, '{}'
    )$$,
  '42501',
  null,
  'client cannot insert events directly'
);

select throws_ok(
  $$insert into public.action_runs (
      id, user_id, action_rule_id, event_id, provider, input
    ) values (
      '17400000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '14000000-0000-0000-0000-000000000001',
      '13000000-0000-0000-0000-000000000001',
      'google-tasks', '{}'
    )$$,
  '42501',
  null,
  'client cannot insert action runs directly'
);

select throws_ok(
  $$insert into public.ai_disclosures (
      id, user_id, source_item_id, model, disclosed_fields, purpose
    ) values (
      '17500000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000001',
      '11100000-0000-0000-0000-000000000001',
      'blocked-model', array['subject'], 'blocked direct write'
    )$$,
  '42501',
  null,
  'client cannot insert AI disclosures directly'
);

select throws_ok(
  $$insert into public.audit_log (user_id, actor_type, action, target_type)
    values (
      '10000000-0000-0000-0000-000000000001', 'user', 'blocked', 'blocked'
    )$$,
  '42501',
  null,
  'client cannot insert audit rows directly'
);

select throws_ok(
  $$select public.decide_action_run(
      public.relay_action_run_id('25000000-0000-0000-0000-000000000002', '24000000-0000-0000-0000-000000000002'), 'approve'
    )$$,
  'P0002',
  null,
  'user cannot decide another tenant action run'
);

select results_eq(
  $$select status::text from public.decide_action_run(
      public.relay_action_run_id('14000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001'), 'approve'
    )$$,
  $$values ('approved'::text)$$,
  'user can approve own awaiting action run'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select is(
  public.authorize_device_ingress('10100000-0000-0000-0000-000000000001'),
  false,
  'second user cannot authorize first tenant installation'
);

select results_eq(
  $$select table_name, visible_rows
    from (
      values
        ('action_rules', (select count(*)::bigint from public.action_rules)),
        ('action_runs', (select count(*)::bigint from public.action_runs)),
        ('ai_disclosures', (select count(*)::bigint from public.ai_disclosures)),
        ('audit_log', (select count(*)::bigint from public.audit_log)),
        ('categories', (select count(*)::bigint from public.categories)),
        ('classifications', (select count(*)::bigint from public.classifications)),
        ('connections', (select count(*)::bigint from public.connections)),
        ('devices', (select count(*)::bigint from public.devices)),
        ('filter_rules', (select count(*)::bigint from public.filter_rules)),
        ('profiles', (select count(*)::bigint from public.profiles)),
        ('relay_events', (select count(*)::bigint from public.relay_events)),
        ('source_items', (select count(*)::bigint from public.source_items))
    ) as visibility(table_name, visible_rows)
    order by table_name$$,
  $$values
      ('action_rules', 1::bigint),
      ('action_runs', 1::bigint),
      ('ai_disclosures', 1::bigint),
      ('audit_log', 1::bigint),
      ('categories', 10::bigint),
      ('classifications', 1::bigint),
      ('connections', 1::bigint),
      ('devices', 2::bigint),
      ('filter_rules', 1::bigint),
      ('profiles', 1::bigint),
      ('relay_events', 1::bigint),
      ('source_items', 1::bigint)$$,
  'second user sees only second tenant rows across every table'
);

select * from finish();
rollback;
