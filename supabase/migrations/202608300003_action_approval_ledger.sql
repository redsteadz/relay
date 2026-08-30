-- Tenant-bound action proposal and approval ledger (issue #29).
--
-- The foundation schema already carried `action_rules` and `action_runs`. What it did not carry is
-- the guarantee that a run's identity, provider, and approval state can only come from an enabled
-- rule the tenant owns. This migration closes that: identity becomes a deterministic function of
-- the rule/event pair, provider becomes a referential fact rather than a copied column, and every
-- write moves behind a transition-validated routine that records metadata-only audit.

-- Deterministic action identity ------------------------------------------------------------------

-- UUIDv5 over `<action rule>\x00<event>`. The namespace is itself the UUIDv5 of
-- "relay.action-run.v1" under the standard DNS namespace, so it is reproducible from a label rather
-- than an arbitrary constant. `apps/pipeline` mirrors this in `relayActionRunId` so a caller can
-- derive a provider idempotency key before the row exists; this function stays the authority.
create function public.relay_action_run_id(p_action_rule_id uuid, p_event_id uuid)
returns uuid
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  action_run_namespace constant bytea := decode('aa8114f6a193573c91f9966134b550ca', 'hex');
  name bytea;
  hashed bytea;
begin
  -- A zero byte separates the two identifiers so no pair of inputs can concatenate into another
  -- pair's name. It has to be built as bytea: PostgreSQL text cannot hold a NUL.
  name := convert_to(p_action_rule_id::text, 'UTF8')
    || '\x00'::bytea
    || convert_to(p_event_id::text, 'UTF8');
  hashed := substring(extensions.digest(action_run_namespace || name, 'sha1') from 1 for 16);
  hashed := set_byte(hashed, 6, (get_byte(hashed, 6) & 15) | 80);
  hashed := set_byte(hashed, 8, (get_byte(hashed, 8) & 63) | 128);
  return encode(hashed, 'hex')::uuid;
end;
$$;

revoke all on function public.relay_action_run_id(uuid, uuid) from public, anon;
grant execute on function public.relay_action_run_id(uuid, uuid) to authenticated, service_role;

-- Tenant and provider binding ---------------------------------------------------------------------

-- Lets a run reference its rule's provider as a foreign key rather than an independently written
-- column, so the two cannot disagree.
alter table public.action_rules
  add constraint action_rules_user_id_id_provider_key unique (user_id, id, provider);

alter table public.action_runs
  -- Identity is derived, not assigned. A second proposal for the same rule and event computes the
  -- same UUID, so a lost response cannot create a second action with a new id, and a provider
  -- idempotency key derived from it stays stable across retries.
  add constraint action_runs_id_is_deterministic check (
    id = public.relay_action_run_id(action_rule_id, event_id)
  ),
  -- Provider is now a fact about the rule. Writing a run whose provider differs from its rule's is
  -- a referential error rather than a silently divergent row.
  add constraint action_runs_provider_matches_rule
    foreign key (user_id, action_rule_id, provider)
    references public.action_rules(user_id, id, provider)
    on delete restrict,
  -- Approval cannot be timestamped while the run still has no decision. Cancellation is deliberately
  -- not covered: account deletion cancels an already-approved run and must keep its approval time.
  add constraint action_runs_approved_at_requires_decision check (
    approved_at is null or status not in ('proposed', 'awaiting-approval')
  );

-- Records which mode was in force when the run was proposed, so the ledger explains itself: an
-- automatically approved run shows that its rule said so at proposal time, even if the rule is
-- edited afterwards.
alter table public.action_runs
  add column approval_mode text not null default 'required'
    check (approval_mode in ('required', 'automatic'));

-- No new index here: the foundation schema already carries
-- `action_runs_user_status_idx (user_id, status, created_at desc)`, which covers the tenant/status
-- reads this ledger adds.

-- Only routines write runs. RLS already withheld an insert/update/delete policy from authenticated;
-- revoking the grants as well means a future policy cannot re-open a direct write path by accident.
-- `action_rules` keeps its service-role grants: the Gmail disconnect routine is security invoker and
-- detaches rules as service role.
revoke insert, update, delete on public.action_runs from authenticated, service_role;

-- Proposal ----------------------------------------------------------------------------------------

create function public.propose_action_run_v1(
  p_user_id uuid,
  p_action_rule_id uuid,
  p_event_id uuid,
  p_input jsonb
)
returns public.action_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.action_rules;
  proposed public.action_runs;
  target_id uuid;
  target_status public.action_status;
  target_approved_at timestamptz;
begin
  if p_user_id is null or p_action_rule_id is null or p_event_id is null then
    raise exception 'Action proposal tenant, rule, and event are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'Action input must be an object' using errcode = '22023';
  end if;
  -- The same guard the filter compiler uses. Input is rendered upstream from a rule template and an
  -- event, and neither may smuggle a provider, endpoint, operation, or credential into the run.
  if public.filter_plan_has_forbidden_keys(p_input) then
    raise exception 'Action input cannot select providers, operations, endpoints, or credentials'
      using errcode = '22023';
  end if;

  -- Enabled is the gate. Connection removal detaches and disables a rule in the same statement, so
  -- a rule whose credential is gone cannot propose here either.
  select * into rule
  from public.action_rules
  where user_id = p_user_id and id = p_action_rule_id and enabled
  for share;
  if rule.id is null then
    raise exception 'Action rule is unavailable or disabled' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.relay_events where user_id = p_user_id and id = p_event_id
  ) then
    raise exception 'Action event is unavailable' using errcode = 'P0002';
  end if;

  target_id := public.relay_action_run_id(p_action_rule_id, p_event_id);
  -- Read from the persisted rule. There is deliberately no parameter for this: a caller, a rendered
  -- template, or a model cannot ask for automatic approval.
  if rule.approval_mode = 'automatic' then
    target_status := 'approved';
    target_approved_at := now();
  else
    target_status := 'awaiting-approval';
    target_approved_at := null;
  end if;

  insert into public.action_runs (
    id, user_id, action_rule_id, event_id, provider, status, approval_mode, input, approved_at
  ) values (
    target_id, p_user_id, p_action_rule_id, p_event_id, rule.provider, target_status,
    rule.approval_mode, p_input, target_approved_at
  )
  on conflict (user_id, action_rule_id, event_id) do nothing
  returning * into proposed;

  if proposed.id is null then
    -- A repeat proposal converges on the row that already exists and writes no second audit record,
    -- so a redelivered message cannot duplicate the ledger or its history.
    select * into proposed
    from public.action_runs
    where user_id = p_user_id and action_rule_id = p_action_rule_id and event_id = p_event_id;
    return proposed;
  end if;

  insert into public.audit_log (
    user_id, actor_type, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    'system',
    'action.proposed',
    'action_run',
    proposed.id::text,
    jsonb_build_object(
      'provider', proposed.provider,
      'approvalMode', proposed.approval_mode,
      'status', proposed.status,
      'actionRuleId', proposed.action_rule_id,
      'eventId', proposed.event_id
    )
  );

  return proposed;
end;
$$;

revoke all on function public.propose_action_run_v1(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.propose_action_run_v1(uuid, uuid, uuid, jsonb) to service_role;

-- Approval ----------------------------------------------------------------------------------------

-- Replaces the foundation version, which accepted only `awaiting-approval` and recorded no metadata.
-- Approval now re-reads the rule, cancellation covers every state that has not started running, and
-- both write the transition they performed.
create or replace function public.decide_action_run(p_action_run_id uuid, p_decision text)
returns public.action_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  decided public.action_runs;
  current_run public.action_runs;
  next_status public.action_status;
  tenant uuid := (select auth.uid());
begin
  if tenant is null then
    raise exception 'Action decisions require an authenticated tenant' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approve', 'cancel') then
    raise exception 'Decision must be approve or cancel' using errcode = '22023';
  end if;

  select * into current_run
  from public.action_runs
  where id = p_action_run_id and user_id = tenant
  for update;
  if current_run.id is null then
    raise exception 'Action run is unavailable' using errcode = 'P0002';
  end if;

  -- Transition table. Approval is only meaningful before the action starts; cancellation stays
  -- available until it does. A terminal run is never re-decided.
  if p_decision = 'approve' then
    if current_run.status <> 'awaiting-approval' then
      raise exception 'Action run is no longer awaiting approval' using errcode = 'P0002';
    end if;
    if not exists (
      select 1 from public.action_rules
      where user_id = tenant and id = current_run.action_rule_id and enabled
    ) then
      raise exception 'Action rule is unavailable or disabled' using errcode = 'P0002';
    end if;
    next_status := 'approved';
  else
    if current_run.status not in ('proposed', 'awaiting-approval', 'approved') then
      raise exception 'Action run can no longer be cancelled' using errcode = 'P0002';
    end if;
    next_status := 'cancelled';
  end if;

  update public.action_runs
  set status = next_status,
      approved_at = case when next_status = 'approved' then now() else approved_at end
  where id = p_action_run_id and user_id = tenant
  returning * into decided;

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    decided.user_id,
    'user',
    decided.user_id::text,
    case when next_status = 'approved' then 'action.approved' else 'action.cancelled' end,
    'action_run',
    decided.id::text,
    jsonb_build_object(
      'provider', decided.provider,
      'fromStatus', current_run.status,
      'toStatus', decided.status
    )
  );

  return decided;
end;
$$;

revoke all on function public.decide_action_run(uuid, text) from public, anon;
grant execute on function public.decide_action_run(uuid, text) to authenticated;

-- Workflow eligibility ----------------------------------------------------------------------------

-- A Workflow may only start from committed ledger state. This is the single place that grants that
-- permission: it moves an approved run to `running` under a row lock, so two concurrent claims
-- cannot both start one, and it re-checks the rule because approval may predate a rule being
-- disabled. Dispatch itself stays unimplemented until the provider issues; this is the gate it will
-- have to pass through.
create function public.claim_action_run_for_workflow_v1(
  p_user_id uuid,
  p_action_run_id uuid,
  p_workflow_instance_id text
)
returns public.action_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_run public.action_runs;
  claimed public.action_runs;
begin
  if p_user_id is null or p_action_run_id is null then
    raise exception 'Workflow claim tenant and run are required' using errcode = '22023';
  end if;
  if p_workflow_instance_id is null
    or btrim(p_workflow_instance_id) = ''
    or char_length(p_workflow_instance_id) > 256
  then
    raise exception 'Workflow instance must contain 1 to 256 characters' using errcode = '22023';
  end if;

  select * into current_run
  from public.action_runs
  where user_id = p_user_id and id = p_action_run_id
  for update;
  if current_run.id is null then
    raise exception 'Action run is unavailable' using errcode = 'P0002';
  end if;

  -- A lost response repeating the same claim converges on the running row without starting a second
  -- attempt. A different instance claiming a running row is a genuine conflict.
  if current_run.status = 'running' then
    if current_run.workflow_instance_id is not distinct from p_workflow_instance_id then
      return current_run;
    end if;
    raise exception 'Action run is already claimed by another workflow' using errcode = '55006';
  end if;

  if current_run.status <> 'approved' then
    raise exception 'Action run is not approved for execution' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from public.action_rules
    where user_id = p_user_id and id = current_run.action_rule_id and enabled
  ) then
    raise exception 'Action rule is unavailable or disabled' using errcode = 'P0002';
  end if;

  update public.action_runs
  set status = 'running',
      workflow_instance_id = p_workflow_instance_id,
      attempt_count = attempt_count + 1
  where user_id = p_user_id and id = p_action_run_id
  returning * into claimed;

  insert into public.audit_log (
    user_id, actor_type, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    'system',
    'action.claimed',
    'action_run',
    claimed.id::text,
    jsonb_build_object(
      'provider', claimed.provider,
      'attemptCount', claimed.attempt_count,
      'fromStatus', current_run.status
    )
  );

  return claimed;
end;
$$;

revoke all on function public.claim_action_run_for_workflow_v1(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.claim_action_run_for_workflow_v1(uuid, uuid, text) to service_role;

comment on function public.relay_action_run_id(uuid, uuid) is
  'Deterministic UUIDv5 action identity for one action rule and event pair.';
comment on column public.action_runs.approval_mode is
  'Approval mode copied from the owning rule at proposal time, for ledger provenance.';
