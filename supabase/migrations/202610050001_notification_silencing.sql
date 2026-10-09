-- Authorization for acting on a source notification.
--
-- `filter_rules.dismiss_source_notification` and `filter_rules.dismissal_dry_run_completed_at` have
-- existed since the initial schema with no reader and no writer. They cannot have one: a filter
-- revision is immutable. `filter_rules_enforce_immutability` refuses every update to the table
-- except a narrow safety-disable of `enabled`, so a column on that row can be written once at insert
-- and never again -- and a dry run that completes days later, or an authorization a person withdraws,
-- is exactly a later write. The columns were unreachable by construction, which is the likeliest
-- reason nothing ever read them.
--
-- So the authorization moves beside the revision rather than onto it, for the same reason
-- `hidden_inbox_events` lives beside `relay_events`: one row is a machine-owned immutable record,
-- the other is a person's decision that changes over time, and forcing the second into the first
-- loses one of them. Keying the authorization to a revision id also makes withdrawal on edit
-- automatic -- a new revision simply has no authorization row.
--
-- See ADR-0017. Acting on a notification is irreversible from Relay's point of view, so every
-- routine here is the sole writer of the row it touches, derives its tenant from `auth.uid()`, and
-- writes `audit_log` in the same statement as the change.

-- The explicit application predicate ---------------------------------------------------------------

-- Whether a plan's deterministic expression *guarantees* an explicit application predicate.
--
-- #38's first criterion is that a rule naming no application cannot act on a notification. Checking
-- that a plan merely mentions `source.applicationId` somewhere is not that check: a predicate inside
-- one branch of an `any`, or under a `not`, does not constrain which app a notification came from.
--
-- So the walk asks whether every way the expression can be satisfied passes through such a
-- predicate: an `all` needs one guaranteeing child, an `any` needs all of them to guarantee, and a
-- `not` guarantees nothing and is refused. `never` is vacuously safe because it matches nothing.
-- Only `equals` and `in` bind the value; `contains`, `starts-with`, and `exists` do not name an
-- application, they describe one.
create function public.filter_expression_binds_application(p_expression jsonb, p_depth integer default 0)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  child jsonb;
begin
  -- Mirrors the contract's expression depth bound. A plan deeper than this never passed
  -- `filterExpressionSchema`, so refusing is both safe and the only honest answer.
  if p_expression is null or jsonb_typeof(p_expression) <> 'object' or p_depth > 8 then
    return false;
  end if;

  if p_expression ? 'never' then
    return true;
  end if;

  if p_expression ? 'not' then
    return false;
  end if;

  if p_expression ? 'all' then
    if jsonb_typeof(p_expression -> 'all') <> 'array' then
      return false;
    end if;
    for child in select value from jsonb_array_elements(p_expression -> 'all') loop
      if public.filter_expression_binds_application(child, p_depth + 1) then
        return true;
      end if;
    end loop;
    return false;
  end if;

  if p_expression ? 'any' then
    if jsonb_typeof(p_expression -> 'any') <> 'array'
      or jsonb_array_length(p_expression -> 'any') = 0 then
      return false;
    end if;
    for child in select value from jsonb_array_elements(p_expression -> 'any') loop
      if not public.filter_expression_binds_application(child, p_depth + 1) then
        return false;
      end if;
    end loop;
    return true;
  end if;

  return p_expression ->> 'field' = 'source.applicationId'
    and p_expression ->> 'operator' in ('equals', 'in');
end;
$$;

comment on function public.filter_expression_binds_application(jsonb, integer) is
  'Whether every satisfying assignment of a deterministic filter expression binds source.applicationId.';

revoke all on function public.filter_expression_binds_application(jsonb, integer) from public, anon;
grant execute on function public.filter_expression_binds_application(jsonb, integer)
  to authenticated, service_role;

-- Retiring the unreachable columns -----------------------------------------------------------------

-- Dropping rather than leaving them: a column that cannot be written is a standing invitation to
-- write code against it, and the next person to try would rediscover the immutability trigger the
-- hard way. Nothing has ever read or written either, so there is no data to preserve.
--
-- The table-level check constraint goes with them, and with it a conflict worth naming.
-- `filter_rules_check` required `approval_mode = 'automatic'` before `dismiss_source_notification`
-- could be true. That contradicted `docs/architecture/action-model.md` -- "notification dismissal is
-- separate from provider action approval" -- and it was unsafe rather than merely redundant:
-- `action_rules` reference filter rules, so opting into a quieter phone would have converted that
-- rule's provider actions from requiring approval to running automatically. Asking for one
-- notification to stop interrupting you would have authorized an irreversible external effect. The
-- replacement gates below carry no opinion about `approval_mode`.
alter table public.filter_rules
  drop constraint filter_rules_check,
  drop column dismiss_source_notification,
  drop column dismissal_dry_run_completed_at;

-- The authorization --------------------------------------------------------------------------------

create table public.notification_dismissal_authorizations (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- A specific revision, not a series. Editing a rule writes a new revision, which has no row here,
  -- so an edit withdraws authorization by construction rather than by a trigger remembering to.
  filter_rule_id uuid not null,
  action text not null check (action in ('snooze', 'dismiss')),
  dry_run_started_at timestamptz not null default now(),
  dry_run_completed_at timestamptz,
  -- Null until the tenant reviews the dry run and allows the rule to act.
  authorized_at timestamptz,
  -- What the device observed during the window. Evidence recorded with the decision, not a gate.
  observed_count integer check (observed_count is null or observed_count >= 0),
  matched_count integer check (matched_count is null or matched_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, filter_rule_id),
  foreign key (user_id, filter_rule_id) references public.filter_rules(user_id, id) on delete cascade,
  constraint notification_dismissal_window_ordered check (
    dry_run_completed_at is null or dry_run_completed_at >= dry_run_started_at
  ),
  -- The gate, in the schema rather than only in the routine: nothing may be authorized to act on a
  -- notification without a completed observation window behind it.
  constraint notification_dismissal_needs_completed_dry_run check (
    authorized_at is null or dry_run_completed_at is not null
  ),
  constraint notification_dismissal_counts_consistent check (
    matched_count is null or observed_count is null or matched_count <= observed_count
  )
);

comment on table public.notification_dismissal_authorizations is
  'Whether one filter revision may snooze or cancel a matching device notification, and the dry-run evidence behind it. Keyed to a revision, so an edit withdraws it.';

alter table public.notification_dismissal_authorizations enable row level security;

create policy "users view own notification dismissal authorizations"
on public.notification_dismissal_authorizations
for select using ((select auth.uid()) = user_id);

-- Read-only to clients. Every change goes through a routine that validates the transition and
-- records it.
grant select on public.notification_dismissal_authorizations to authenticated;
grant all on public.notification_dismissal_authorizations to service_role;

create trigger notification_dismissal_authorizations_set_updated_at
before update on public.notification_dismissal_authorizations
for each row execute function public.set_updated_at();

-- A tenant-wide stop. Per-rule authorization is the normal control; this is the one a person reaches
-- for when they do not want to reason about which rule did it.
create table public.notification_dismissal_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kill_switch_engaged boolean not null default false,
  updated_at timestamptz not null default now()
);

comment on table public.notification_dismissal_settings is
  'Tenant-wide stop for acting on device notifications. Engaged means no rule may act, whatever its own authorization says.';

alter table public.notification_dismissal_settings enable row level security;

create policy "users view own notification dismissal settings"
on public.notification_dismissal_settings
for select using ((select auth.uid()) = user_id);

grant select on public.notification_dismissal_settings to authenticated;
grant all on public.notification_dismissal_settings to service_role;

-- Routines -----------------------------------------------------------------------------------------

-- How long a dry run must be observed before a rule may act.
--
-- The window is measured on the server clock between two routine calls rather than attested by the
-- device, because a device that could report its own window could report one it never ran.
create function public.notification_dismissal_dry_run_minimum()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '72 hours' $$;

-- Common validation for a revision a tenant is asking to authorize.
--
-- Returns the revision. Raises rather than returning null, so no caller can forget to check.
create function public.dismissible_filter_rule(p_filter_rule_id uuid)
returns public.filter_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.filter_rules;
  tenant uuid := (select auth.uid());
begin
  if tenant is null then
    raise exception 'Notification dismissal requires an authenticated tenant' using errcode = '42501';
  end if;

  select * into rule
  from public.filter_rules
  where id = p_filter_rule_id and user_id = tenant;
  if rule.id is null then
    raise exception 'Filter rule is unavailable' using errcode = 'P0002';
  end if;

  if not (rule.plan ? 'deterministic') or rule.plan ? 'semantic' then
    raise exception 'Acting on a notification needs a deterministic plan with no semantic clause'
      using errcode = '22023';
  end if;

  if not public.filter_expression_binds_application(rule.plan -> 'deterministic') then
    raise exception 'Acting on a notification needs an explicit application predicate'
      using errcode = '22023';
  end if;

  return rule;
end;
$$;

revoke all on function public.dismissible_filter_rule(uuid) from public, anon, authenticated;

-- Opens the observation window. Re-running restarts it, which is what a reconsidered rule needs.
create function public.start_notification_dismissal_dry_run_v1(
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

  -- Starting over withdraws the authorization the previous window earned. Observations from a window
  -- that was restarted are not evidence for the rule as it now stands.
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

revoke all on function public.start_notification_dismissal_dry_run_v1(uuid, text) from public, anon;
grant execute on function public.start_notification_dismissal_dry_run_v1(uuid, text) to authenticated;

-- Closes the window once the server clock says it ran long enough.
--
-- The counts are what the device observed and are recorded as such. They are evidence a person
-- reviews, not a gate: the gate is the elapsed window, which the device cannot report.
create function public.complete_notification_dismissal_dry_run_v1(
  p_filter_rule_id uuid,
  p_observed integer,
  p_matched integer
)
returns public.notification_dismissal_authorizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.filter_rules := public.dismissible_filter_rule(p_filter_rule_id);
  current_row public.notification_dismissal_authorizations;
  completed public.notification_dismissal_authorizations;
begin
  if p_observed is null or p_matched is null or p_observed < 0 or p_matched < 0
    or p_matched > p_observed then
    raise exception 'Dry-run observation counts are invalid' using errcode = '22023';
  end if;

  select * into current_row
  from public.notification_dismissal_authorizations
  where user_id = rule.user_id and filter_rule_id = rule.id
  for update;
  if current_row.filter_rule_id is null then
    raise exception 'No dry run has been started for this rule' using errcode = 'P0002';
  end if;
  if now() - current_row.dry_run_started_at < public.notification_dismissal_dry_run_minimum() then
    raise exception 'The dry-run observation window is not complete' using errcode = 'P0002';
  end if;
  -- A window in which nothing was observed is not evidence that the rule behaves correctly, it is
  -- evidence that nothing happened.
  if p_observed = 0 then
    raise exception 'A dry run with no observations cannot authorize dismissal' using errcode = 'P0002';
  end if;

  update public.notification_dismissal_authorizations
  set dry_run_completed_at = now(),
      observed_count = p_observed,
      matched_count = p_matched
  where user_id = rule.user_id and filter_rule_id = rule.id
  returning * into completed;

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    rule.user_id,
    'user',
    rule.user_id::text,
    'notification.dismissal_dry_run_completed',
    'filter_rule',
    rule.id::text,
    jsonb_build_object(
      'ruleVersion', rule.version,
      'dismissalAction', completed.action,
      'observed', p_observed,
      'matched', p_matched,
      'windowHours', floor(
        extract(epoch from (completed.dry_run_completed_at - completed.dry_run_started_at)) / 3600
      )
    )
  );

  return completed;
end;
$$;

revoke all on function public.complete_notification_dismissal_dry_run_v1(uuid, integer, integer)
from public, anon;
grant execute on function public.complete_notification_dismissal_dry_run_v1(uuid, integer, integer)
  to authenticated;

-- The enable transition, and the per-rule withdrawal that reverses it.
--
-- Withdrawing is never gated. A control that stops an irreversible capability must not be able to
-- fail validation.
create function public.set_notification_dismissal_v1(p_filter_rule_id uuid, p_enabled boolean)
returns public.notification_dismissal_authorizations
language plpgsql
security definer
set search_path = ''
as $$
declare
  tenant uuid := (select auth.uid());
  rule public.filter_rules;
  current_row public.notification_dismissal_authorizations;
  decided public.notification_dismissal_authorizations;
begin
  if p_enabled is null then
    raise exception 'Dismissal state is required' using errcode = '22023';
  end if;
  if tenant is null then
    raise exception 'Notification dismissal requires an authenticated tenant' using errcode = '42501';
  end if;

  if not p_enabled then
    update public.notification_dismissal_authorizations
    set authorized_at = null
    where user_id = tenant and filter_rule_id = p_filter_rule_id
    returning * into decided;
    if decided.filter_rule_id is null then
      raise exception 'No dry run has been started for this rule' using errcode = 'P0002';
    end if;
  else
    rule := public.dismissible_filter_rule(p_filter_rule_id);
    if not rule.enabled then
      raise exception 'A disabled filter rule cannot act on a notification' using errcode = 'P0002';
    end if;

    select * into current_row
    from public.notification_dismissal_authorizations
    where user_id = rule.user_id and filter_rule_id = rule.id
    for update;
    if current_row.filter_rule_id is null then
      raise exception 'No dry run has been started for this rule' using errcode = 'P0002';
    end if;
    if current_row.dry_run_completed_at is null then
      raise exception 'Acting on a notification needs a completed dry run' using errcode = 'P0002';
    end if;

    update public.notification_dismissal_authorizations
    set authorized_at = now()
    where user_id = rule.user_id and filter_rule_id = rule.id
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

revoke all on function public.set_notification_dismissal_v1(uuid, boolean) from public, anon;
grant execute on function public.set_notification_dismissal_v1(uuid, boolean) to authenticated;

-- The tenant-wide stop.
--
-- Engaging it does not clear per-rule authorization. A person pulling the kill switch is stopping
-- the behaviour now, not discarding the dry runs they have already sat through; releasing it restores
-- exactly what they had authorized.
create function public.set_notification_dismissal_kill_switch_v1(p_engaged boolean)
returns public.notification_dismissal_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  tenant uuid := (select auth.uid());
  settings public.notification_dismissal_settings;
begin
  if tenant is null then
    raise exception 'Notification dismissal requires an authenticated tenant' using errcode = '42501';
  end if;
  if p_engaged is null then
    raise exception 'Kill-switch state is required' using errcode = '22023';
  end if;

  insert into public.notification_dismissal_settings (user_id, kill_switch_engaged)
  values (tenant, p_engaged)
  on conflict (user_id) do update
  set kill_switch_engaged = p_engaged, updated_at = now()
  returning * into settings;

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    tenant,
    'user',
    tenant::text,
    case when p_engaged
      then 'notification.dismissal_kill_switch_engaged'
      else 'notification.dismissal_kill_switch_released'
    end,
    'notification_dismissal_settings',
    tenant::text,
    jsonb_build_object('engaged', p_engaged)
  );

  return settings;
end;
$$;

revoke all on function public.set_notification_dismissal_kill_switch_v1(boolean) from public, anon;
grant execute on function public.set_notification_dismissal_kill_switch_v1(boolean) to authenticated;
