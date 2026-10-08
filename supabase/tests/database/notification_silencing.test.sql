begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

-- Fixtures run as the migration role. Filter revisions are immutable, so every rule below is created
-- in its final shape -- which is also why the authorization lives in its own table.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '80000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'quiet-one@example.test', '', now(), now(), now()
  ),
  (
    '80000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'quiet-two@example.test', '', now(), now(), now()
  );

-- R1 names an application and narrows by subject: the shape a rule is allowed to have.
insert into public.filter_rules (id, user_id, name, intent, plan) values (
  '80300000-0000-4000-8000-000000000001',
  '80000000-0000-4000-8000-000000000001',
  'Delivery pings', 'delivery notifications from the courier app',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"delivery notifications from the courier app","deterministic":{"all":[{"field":"source.applicationId","operator":"equals","value":"com.courier.app"},{"field":"subject","operator":"contains","value":"out for delivery"}]}}'
);

-- R2 names no application. It can file a capture; it can never act on a notification.
insert into public.filter_rules (id, user_id, name, intent, plan) values (
  '80300000-0000-4000-8000-000000000002',
  '80000000-0000-4000-8000-000000000001',
  'Bank receipts', 'from the bank',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"from the bank","deterministic":{"field":"sender","operator":"contains","value":"bank"}}'
);

-- R3 names an application and also asks a model. The device evaluates the clause itself, so this is
-- authorizable: the deterministic part still bounds what reaches a model (ADR-0019).
insert into public.filter_rules (id, user_id, name, intent, plan) values (
  '80300000-0000-4000-8000-000000000003',
  '80000000-0000-4000-8000-000000000001',
  'Maybe urgent', 'urgent courier notifications',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"urgent courier notifications","deterministic":{"field":"source.applicationId","operator":"equals","value":"com.courier.app"},"semantic":{"question":"is this urgent?","minimumConfidence":0.8,"allowedFields":["subject"]}}'
);

-- R5 is only a semantic clause: nothing literal bounds what would reach a model.
insert into public.filter_rules (id, user_id, name, intent, plan) values (
  '80300000-0000-4000-8000-000000000005',
  '80000000-0000-4000-8000-000000000001',
  'Only a model', 'anything urgent',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"anything urgent","semantic":{"question":"is this urgent?","minimumConfidence":0.8,"allowedFields":["subject"]}}'
);

-- R6 decides with nothing at all. `filter_rules.plan` has no shape constraint, so the row inserts
-- and the routine is the only thing refusing it.
insert into public.filter_rules (id, user_id, name, intent, plan) values (
  '80300000-0000-4000-8000-000000000006',
  '80000000-0000-4000-8000-000000000001',
  'Decides nothing', 'undecidable',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"undecidable"}'
);

insert into public.filter_rules (id, user_id, name, intent, plan, enabled) values (
  '80300000-0000-4000-8000-000000000004',
  '80000000-0000-4000-8000-000000000001',
  'Turned off', 'disabled courier rule',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"disabled courier rule","deterministic":{"field":"source.applicationId","operator":"equals","value":"com.courier.app"}}',
  false
);

insert into public.filter_rules (id, user_id, name, intent, plan) values (
  '80300000-0000-4000-8000-0000000000f2',
  '80000000-0000-4000-8000-000000000002',
  'Other tenant courier', 'other tenant courier rule',
  '{"schemaVersion":1,"compilerVersion":1,"intent":"other tenant courier rule","deterministic":{"field":"source.applicationId","operator":"equals","value":"com.courier.app"}}'
);

-- The retired columns ------------------------------------------------------------------------------

-- They could never be written: `filter_rules_enforce_immutability` refuses every update to the
-- table. Leaving them would invite the next person to write code against a column that cannot
-- change.
select hasnt_column('public', 'filter_rules', 'dismiss_source_notification',
  'the unreachable dismissal flag is gone from the immutable revision');
select hasnt_column('public', 'filter_rules', 'dismissal_dry_run_completed_at',
  'the unreachable dry-run column is gone from the immutable revision');

-- And with them the constraint that tied a quieter phone to automatic provider actions.
select is(
  (select count(*) from pg_constraint
    where conrelid = 'public.filter_rules'::regclass and conname = 'filter_rules_check'),
  0::bigint,
  'dismissal no longer requires automatic provider-action approval'
);

-- Acting as tenant one -----------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub":"80000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

select throws_ok(
  $q$insert into public.notification_dismissal_authorizations (user_id, filter_rule_id, action)
     values ('80000000-0000-4000-8000-000000000001',
             '80300000-0000-4000-8000-000000000001', 'dismiss')$q$,
  '42501',
  null,
  'a client cannot authorize itself directly'
);

-- #38 required an explicit application predicate and ADR-0020 lifted it: quieting by description is
-- the feature, and the dry run, the review and the stops are what make the act safe.
select lives_ok(
  $q$select public.start_notification_dismissal_dry_run_v1('80300000-0000-4000-8000-000000000002')$q$,
  'a rule naming no application can start a dry run'
);

select lives_ok(
  $q$select public.start_notification_dismissal_dry_run_v1('80300000-0000-4000-8000-000000000003')$q$,
  'a rule carrying a semantic clause can start a dry run'
);

-- A rule that is only a semantic clause is now authorizable too. The device compiles it to a rule
-- with no literal tests and asks the reader's own model about each captured notification.
select lives_ok(
  $q$select public.start_notification_dismissal_dry_run_v1('80300000-0000-4000-8000-000000000005')$q$,
  'a rule with no deterministic part can start a dry run'
);

select throws_ok(
  $q$select public.start_notification_dismissal_dry_run_v1('80300000-0000-4000-8000-000000000004')$q$,
  'P0002',
  null,
  'a disabled rule cannot start a dry run'
);

select throws_ok(
  $q$select public.start_notification_dismissal_dry_run_v1('80300000-0000-4000-8000-0000000000f2')$q$,
  'P0002',
  null,
  'another tenant rule is unavailable'
);

select throws_ok(
  $q$select public.start_notification_dismissal_dry_run_v1(
    '80300000-0000-4000-8000-000000000001', 'delete')$q$,
  '22023',
  null,
  'a rule can only be asked to snooze or dismiss'
);

select throws_ok(
  $q$select public.set_notification_dismissal_v1('80300000-0000-4000-8000-000000000001', true)$q$,
  'P0002',
  null,
  'nothing can be authorized before a dry run exists'
);

select is(
  (select (public.start_notification_dismissal_dry_run_v1(
    '80300000-0000-4000-8000-000000000001', 'dismiss')).action),
  'dismiss',
  'starting a dry run records the action it is for'
);

select ok(
  (select dry_run_started_at is not null and authorized_at is null
    from public.notification_dismissal_authorizations
    where filter_rule_id = '80300000-0000-4000-8000-000000000001'),
  'a started dry run is open and unauthorized'
);

select throws_ok(
  $q$select public.complete_notification_dismissal_dry_run_v1(
    '80300000-0000-4000-8000-000000000001', 12, 3)$q$,
  'P0002',
  null,
  'a dry run cannot be completed before its window elapses'
);

select throws_ok(
  $q$select public.set_notification_dismissal_v1('80300000-0000-4000-8000-000000000001', true)$q$,
  'P0002',
  null,
  'a rule cannot act while the dry run is incomplete'
);

-- Backdating the window is the migration role's to do; a client has no write path to this table.
reset role;
update public.notification_dismissal_authorizations
set dry_run_started_at = now() - interval '96 hours'
where filter_rule_id = '80300000-0000-4000-8000-000000000001';
set local role authenticated;

select throws_ok(
  $q$select public.complete_notification_dismissal_dry_run_v1(
    '80300000-0000-4000-8000-000000000001', 0, 0)$q$,
  'P0002',
  null,
  'a dry run that observed nothing cannot authorize anything'
);

select throws_ok(
  $q$select public.complete_notification_dismissal_dry_run_v1(
    '80300000-0000-4000-8000-000000000001', 3, 12)$q$,
  '22023',
  null,
  'more matches than observations is refused'
);

select is(
  (select (public.complete_notification_dismissal_dry_run_v1(
    '80300000-0000-4000-8000-000000000001', 12, 3)).observed_count),
  12,
  'an elapsed window with observations completes the dry run and keeps its evidence'
);

select ok(
  (select (public.set_notification_dismissal_v1(
    '80300000-0000-4000-8000-000000000001', true)).authorized_at is not null),
  'a reviewed rule can be authorized to act'
);

select is(
  (select count(*) from public.audit_log
    where user_id = '80000000-0000-4000-8000-000000000001'
      and action = 'notification.dismissal_enabled'
      and target_id = '80300000-0000-4000-8000-000000000001'),
  1::bigint,
  'authorizing a rule writes one audit record'
);

select is(
  (select approval_mode from public.filter_rules
    where id = '80300000-0000-4000-8000-000000000001'),
  'required',
  'authorizing a rule leaves provider-action approval untouched'
);

select ok(
  (select (public.set_notification_dismissal_v1(
    '80300000-0000-4000-8000-000000000001', false)).authorized_at is null),
  'authorization can be withdrawn'
);

select is(
  (select count(*) from public.audit_log
    where user_id = '80000000-0000-4000-8000-000000000001'
      and action = 'notification.dismissal_disabled'),
  1::bigint,
  'withdrawing writes its own audit record'
);

-- Withdrawing keeps the completed window, so restoring does not cost another three days.
select ok(
  (select dry_run_completed_at is not null
    from public.notification_dismissal_authorizations
    where filter_rule_id = '80300000-0000-4000-8000-000000000001'),
  'withdrawing authorization keeps the dry-run evidence'
);

-- Restarting does not: observations from a window that was restarted are not evidence for the rule
-- as it now stands.
select ok(
  (select (public.start_notification_dismissal_dry_run_v1(
    '80300000-0000-4000-8000-000000000001')).dry_run_completed_at is null),
  'restarting a dry run clears the completed window'
);

select is(
  (select (public.start_notification_dismissal_dry_run_v1(
    '80300000-0000-4000-8000-000000000001')).observed_count),
  null::integer,
  'restarting a dry run clears the evidence it replaced'
);

-- A plan with neither part decides nothing and would act on everything. The one plan shape the
-- routine still refuses.
-- Through the public routine, because `dismissible_filter_rule` is revoked from clients.
select throws_ok(
  $q$select public.start_notification_dismissal_dry_run_v1('80300000-0000-4000-8000-000000000006')$q$,
  '22023',
  null,
  'a plan with neither a deterministic nor a semantic part is refused'
);

-- The tenant-wide stop -----------------------------------------------------------------------------

select ok(
  (select (public.set_notification_dismissal_kill_switch_v1(true)).kill_switch_engaged),
  'the kill switch engages'
);

select is(
  (select count(*) from public.audit_log
    where user_id = '80000000-0000-4000-8000-000000000001'
      and action = 'notification.dismissal_kill_switch_engaged'),
  1::bigint,
  'engaging the kill switch writes an audit record'
);

select ok(
  not (select (public.set_notification_dismissal_kill_switch_v1(false)).kill_switch_engaged),
  'the kill switch releases'
);

select throws_ok(
  $q$insert into public.notification_dismissal_settings (user_id, kill_switch_engaged)
     values ('80000000-0000-4000-8000-000000000001', true)$q$,
  '42501',
  null,
  'a client cannot write the kill switch directly'
);

-- Acting as tenant two -----------------------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  '{"sub":"80000000-0000-4000-8000-000000000002","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.notification_dismissal_authorizations),
  0::bigint,
  'a tenant cannot read another tenant authorization'
);

select throws_ok(
  $q$select public.set_notification_dismissal_v1('80300000-0000-4000-8000-000000000001', true)$q$,
  'P0002',
  null,
  'another tenant cannot authorize a rule it does not own'
);

select * from finish();
rollback;
