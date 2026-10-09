-- Authorizing a quiet rule no longer waits, and its action can be changed in place.
--
-- #38 required a completed 72-hour dry run before a rule could act, and changing a rule's action
-- restarted that window. Both are removed. See docs/decisions/0021-direct-quiet-authorization.md.
--
-- The reversibility argument the window rested on was weaker than it was presented as. Relay
-- captures a notification *before* it acts on it -- `onNotificationPosted` enqueues and retains,
-- then calls `actIfAuthorized`, in that order and deliberately -- so anything a rule clears is
-- already in the reader's inbox and in device-local retention. Clearing a notification removes a
-- row from the shade, not the information.
--
-- The dry run stays available and unchanged for a reader who wants evidence before deciding. It is
-- no longer a precondition.

-- The gate was in the schema as well as the routine, which was right while it was a gate. Dropping
-- it leaves `dry_run_completed_at` null for a rule authorized directly, and that null is now the
-- thing that distinguishes "enabled after review" from "enabled straight away" in an audit read.
alter table public.notification_dismissal_authorizations
  drop constraint if exists notification_dismissal_needs_completed_dry_run;

-- Authorizes a rule, with or without a dry run behind it, and sets the action in the same call.
--
-- Upserts, because a reader who never started a dry run has no row to update and the authorization
-- is the row's reason for existing. `p_action` defaults to null meaning "keep whatever is stored",
-- so turning a rule off and on again does not silently change what it does.
create or replace function public.set_notification_dismissal_v1(
  p_filter_rule_id uuid,
  p_enabled boolean,
  p_action text default null
)
returns public.notification_dismissal_authorizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  tenant uuid := (select auth.uid());
  rule public.filter_rules;
  decided public.notification_dismissal_authorizations;
begin
  if p_enabled is null then
    raise exception 'Dismissal state is required' using errcode = '22023';
  end if;
  if tenant is null then
    raise exception 'Notification dismissal requires an authenticated tenant' using errcode = '42501';
  end if;
  if p_action is not null and p_action not in ('snooze', 'dismiss') then
    raise exception 'Action must be snooze or dismiss' using errcode = '22023';
  end if;

  if not p_enabled then
    -- Withdrawing keeps the row, so the dry-run evidence and the action survive a reader turning a
    -- rule off and on again.
    update public.notification_dismissal_authorizations
    set authorized_at = null,
        action = coalesce(p_action, action)
    where user_id = tenant and filter_rule_id = p_filter_rule_id
    returning * into decided;
    if decided.filter_rule_id is null then
      raise exception 'This rule is not authorized' using errcode = 'P0002';
    end if;
  else
    rule := public.dismissible_filter_rule(p_filter_rule_id);
    if not rule.enabled then
      raise exception 'A disabled filter rule cannot act on a notification' using errcode = 'P0002';
    end if;

    insert into public.notification_dismissal_authorizations (
      user_id, filter_rule_id, action, authorized_at
    ) values (rule.user_id, rule.id, coalesce(p_action, 'snooze'), now())
    on conflict (user_id, filter_rule_id) do update
    set authorized_at = now(),
        action = coalesce(p_action, public.notification_dismissal_authorizations.action)
    returning * into decided;
  end if;

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    decided.user_id,
    'user',
    decided.user_id::text,
    case when p_enabled then 'notification.dismissal_enabled' else 'notification.dismissal_disabled' end,
    'filter_rule',
    decided.filter_rule_id::text,
    -- `dryRunCompletedAt` stays in the record and is now null for a rule authorized directly, which
    -- is what distinguishes the two in an audit read.
    jsonb_build_object(
      'dismissalAction', decided.action,
      'dryRunCompletedAt', decided.dry_run_completed_at,
      'observed', decided.observed_count,
      'matched', decided.matched_count
    )
  );

  return decided;
end;
$$;

revoke all on function public.set_notification_dismissal_v1(uuid, boolean, text) from public, anon;
grant execute on function public.set_notification_dismissal_v1(uuid, boolean, text)
  to authenticated, service_role;

-- The two-argument form is gone: PostgREST resolves by argument name, and leaving it would let a
-- stale client reach a routine that still demanded a completed window.
drop function if exists public.set_notification_dismissal_v1(uuid, boolean);

-- Changing a rule's action no longer restarts its observation. The action decides what happens to a
-- notification, not whether the rule matches, so the evidence a reader gathered about *what it
-- matches* is equally true either way.
create or replace function public.start_notification_dismissal_dry_run_v1(
  p_filter_rule_id uuid,
  p_action text default 'snooze'
)
returns public.notification_dismissal_authorizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.filter_rules := public.dismissible_filter_rule(p_filter_rule_id);
  existed boolean;
  authorization_row public.notification_dismissal_authorizations;
begin
  if p_action is null or p_action not in ('snooze', 'dismiss') then
    raise exception 'Action must be snooze or dismiss' using errcode = '22023';
  end if;
  if not rule.enabled then
    raise exception 'A disabled filter rule cannot observe a dry run' using errcode = 'P0002';
  end if;

  select true into existed
  from public.notification_dismissal_authorizations
  where user_id = rule.user_id and filter_rule_id = rule.id;

  insert into public.notification_dismissal_authorizations (
    user_id, filter_rule_id, action, dry_run_started_at
  ) values (rule.user_id, rule.id, p_action, now())
  on conflict (user_id, filter_rule_id) do update
  set action = p_action,
      dry_run_started_at = now(),
      dry_run_completed_at = null,
      authorized_at = null,
      observed_count = null,
      matched_count = null
  returning * into authorization_row;

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    rule.user_id,
    'user',
    rule.user_id::text,
    'notification.dismissal_dry_run_started',
    'filter_rule',
    rule.id::text,
    jsonb_build_object(
      'ruleVersion', rule.version,
      'dismissalAction', p_action,
      'restarted', coalesce(existed, false)
    )
  );

  return authorization_row;
end;
$$;
