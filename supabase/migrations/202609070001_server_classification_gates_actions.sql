-- Require server classification before a category can gate a provider effect (issue #171, ADR-0014).
--
-- A device-authored classification must never gate an external provider effect: trust in client-side
-- classification is bounded to personal inbox organisation, while action dispatch reaches external
-- providers and requires a server-authenticated classification (`origin = 'server'`).

-- Replace propose_action_run_v1 to enforce server classification on category-gated rules
create or replace function public.propose_action_run_v1(
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
  if public.filter_plan_has_forbidden_keys(p_input) then
    raise exception 'Action input cannot select providers, operations, endpoints, or credentials'
      using errcode = '22023';
  end if;

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

  -- A category-gated action rule requires a current server classification (ADR-0014).
  if exists (
    select 1
    from public.filter_rules fr
    where fr.user_id = p_user_id
      and fr.id = rule.filter_rule_id
      and fr.category_id is not null
  ) then
    if not exists (
      select 1
      from public.relay_events re
      join public.filter_rules fr
        on fr.user_id = p_user_id
       and fr.id = rule.filter_rule_id
      join public.classifications c
        on c.user_id = p_user_id
       and c.source_item_id = re.source_item_id
       and c.superseded_at is null
       and c.category_id = fr.category_id
       and c.origin = 'server'
      where re.user_id = p_user_id
        and re.id = p_event_id
    ) then
      raise exception 'Category-gated action requires a server classification' using errcode = 'P0002';
    end if;
  end if;

  target_id := public.relay_action_run_id(p_action_rule_id, p_event_id);
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

-- Replace claim_action_run_for_workflow_v1 to enforce server classification on category-gated claims
create or replace function public.claim_action_run_for_workflow_v1(
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

  -- A category-gated action run requires a current server classification (ADR-0014).
  if exists (
    select 1
    from public.action_rules ar
    join public.filter_rules fr
      on fr.user_id = p_user_id
     and fr.id = ar.filter_rule_id
     and fr.category_id is not null
    where ar.user_id = p_user_id
      and ar.id = current_run.action_rule_id
  ) then
    if not exists (
      select 1
      from public.action_rules ar
      join public.filter_rules fr
        on fr.user_id = p_user_id
       and fr.id = ar.filter_rule_id
      join public.relay_events re
        on re.user_id = p_user_id
       and re.id = current_run.event_id
      join public.classifications c
        on c.user_id = p_user_id
       and c.source_item_id = re.source_item_id
       and c.superseded_at is null
       and c.category_id = fr.category_id
       and c.origin = 'server'
      where ar.user_id = p_user_id
        and ar.id = current_run.action_rule_id
    ) then
      raise exception 'Category-gated action requires a server classification' using errcode = 'P0002';
    end if;
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

revoke all on function public.propose_action_run_v1(uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public.propose_action_run_v1(uuid, uuid, uuid, jsonb) to service_role;

revoke all on function public.claim_action_run_for_workflow_v1(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.claim_action_run_for_workflow_v1(uuid, uuid, text) to service_role;
