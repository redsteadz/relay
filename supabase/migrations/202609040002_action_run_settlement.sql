-- Settles a claimed action run.
--
-- `claim_action_run_for_workflow_v1` moves a run to `running` and is the only path from ledger state
-- to an external effect, but nothing could record what that effect produced. These two routines
-- close that: one records the provider's own identifier for a committed effect, the other records
-- why an attempt produced none and whether another may be made.
--
-- Both are idempotent in the way a retried Workflow step needs. A repeated settlement from the same
-- workflow instance converges on the row it already wrote rather than raising, because the caller
-- cannot tell a lost response from a failed call, and a run that ends twice would either lose the
-- provider reference or record a second, non-existent effect.

create function public.complete_action_run_v1(
  p_user_id uuid,
  p_action_run_id uuid,
  p_workflow_instance_id text,
  p_provider_reference text
)
returns public.action_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_run public.action_runs;
  settled public.action_runs;
begin
  if p_user_id is null or p_action_run_id is null then
    raise exception 'Action settlement tenant and run are required' using errcode = '22023';
  end if;
  if p_workflow_instance_id is null
    or btrim(p_workflow_instance_id) = ''
    or char_length(p_workflow_instance_id) > 256
  then
    raise exception 'Workflow instance must contain 1 to 256 characters' using errcode = '22023';
  end if;
  if p_provider_reference is null
    or btrim(p_provider_reference) = ''
    or char_length(p_provider_reference) > 512
  then
    raise exception 'Provider reference must contain 1 to 512 characters' using errcode = '22023';
  end if;

  select * into current_run
  from public.action_runs
  where user_id = p_user_id and id = p_action_run_id
  for update;
  if current_run.id is null then
    raise exception 'Action run is unavailable' using errcode = 'P0002';
  end if;

  -- Already settled. The same instance reporting the same effect is a redelivery and returns the
  -- stored row; a different reference would mean two effects exist for one approval, which is the
  -- failure this ledger is for, so it is refused rather than overwritten.
  if current_run.status = 'succeeded' then
    if current_run.workflow_instance_id is not distinct from p_workflow_instance_id
      and current_run.provider_reference is not distinct from p_provider_reference
    then
      return current_run;
    end if;
    raise exception 'Action run already recorded a different effect' using errcode = '55006';
  end if;

  if current_run.status <> 'running' then
    raise exception 'Action run is not running' using errcode = 'P0002';
  end if;
  if current_run.workflow_instance_id is distinct from p_workflow_instance_id then
    raise exception 'Action run is claimed by another workflow' using errcode = '55006';
  end if;

  update public.action_runs
  set status = 'succeeded',
      provider_reference = p_provider_reference,
      completed_at = now(),
      error_code = null,
      error_message = null
  where user_id = p_user_id and id = p_action_run_id
  returning * into settled;

  -- The reference is recorded, never the task's content: the audit trail says an effect happened
  -- and how to find it, not what it said.
  insert into public.audit_log (
    user_id, actor_type, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    'system',
    'action.succeeded',
    'action_run',
    p_action_run_id::text,
    jsonb_build_object('provider', settled.provider, 'attemptCount', settled.attempt_count)
  );

  return settled;
end;
$$;

create function public.fail_action_run_v1(
  p_user_id uuid,
  p_action_run_id uuid,
  p_workflow_instance_id text,
  p_error_code text,
  p_retryable boolean
)
returns public.action_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_run public.action_runs;
  settled public.action_runs;
begin
  if p_user_id is null or p_action_run_id is null or p_retryable is null then
    raise exception 'Action failure tenant, run, and retry classification are required'
      using errcode = '22023';
  end if;
  if p_workflow_instance_id is null
    or btrim(p_workflow_instance_id) = ''
    or char_length(p_workflow_instance_id) > 256
  then
    raise exception 'Workflow instance must contain 1 to 256 characters' using errcode = '22023';
  end if;
  if p_error_code is null or p_error_code !~ '^[a-z][a-z0-9-]{0,63}$' then
    raise exception 'Error code must be lowercase, hyphenated, and stable' using errcode = '22023';
  end if;

  select * into current_run
  from public.action_runs
  where user_id = p_user_id and id = p_action_run_id
  for update;
  if current_run.id is null then
    raise exception 'Action run is unavailable' using errcode = 'P0002';
  end if;

  -- A committed effect is never undone by a later failure report. The response that would have
  -- proven success can be lost while the task exists, so success wins over a subsequent failure.
  if current_run.status = 'succeeded' then
    return current_run;
  end if;
  if current_run.status = 'failed' then
    if current_run.workflow_instance_id is not distinct from p_workflow_instance_id then
      return current_run;
    end if;
    raise exception 'Action run already failed under another workflow' using errcode = '55006';
  end if;

  if current_run.status <> 'running' then
    raise exception 'Action run is not running' using errcode = 'P0002';
  end if;
  if current_run.workflow_instance_id is distinct from p_workflow_instance_id then
    raise exception 'Action run is claimed by another workflow' using errcode = '55006';
  end if;

  -- A retryable failure returns the run to `approved` so a later attempt can claim it, keeping the
  -- attempt count that has already been spent. Its workflow instance is cleared, because the next
  -- attempt is a different instance and must not read as a conflicting claim.
  update public.action_runs
  set status = case when p_retryable then 'approved' else 'failed' end::public.action_status,
      workflow_instance_id = case when p_retryable then null else current_run.workflow_instance_id end,
      error_code = p_error_code,
      completed_at = case when p_retryable then null else now() end
  where user_id = p_user_id and id = p_action_run_id
  returning * into settled;

  insert into public.audit_log (
    user_id, actor_type, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    'system',
    case when p_retryable then 'action.attempt_failed' else 'action.failed' end,
    'action_run',
    p_action_run_id::text,
    jsonb_build_object(
      'provider', settled.provider,
      'errorCode', p_error_code,
      'attemptCount', settled.attempt_count,
      'retryable', p_retryable
    )
  );

  return settled;
end;
$$;

revoke all on function public.complete_action_run_v1(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.complete_action_run_v1(uuid, uuid, text, text) to service_role;

revoke all on function public.fail_action_run_v1(uuid, uuid, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.fail_action_run_v1(uuid, uuid, text, text, boolean) to service_role;
