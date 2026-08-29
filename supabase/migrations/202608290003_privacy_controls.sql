-- Privacy settings and account deletion (issue #39).
--
-- Three capabilities, each scoped to the calling tenant:
--   1. read how much raw payload is still retained and when it expires;
--   2. purge that raw payload immediately without touching derived facts;
--   3. request account deletion, and finalize it idempotently.
--
-- Table-level grants in the initial schema are broad (select/insert/update/delete on all tables to
-- authenticated), so row-level security is the only thing restricting access. source_items carries
-- a SELECT policy but no UPDATE policy, so the purge cannot run as the caller and must be security
-- definer with an explicit user_id = auth.uid() predicate. That predicate is the sole tenant
-- boundary for these functions and is covered by two-user tests.

-- Retention visibility. security invoker deliberately: row-level security already limits
-- source_items to the caller's rows, so no explicit tenant predicate is needed or wanted here.
create function public.own_raw_retention_status()
returns table (
  retained_count bigint,
  earliest_expires_at timestamptz,
  latest_expires_at timestamptz
)
language sql
security invoker
stable
set search_path = ''
as $$
  select
    count(*)::bigint,
    min(raw_expires_at),
    max(raw_expires_at)
  from public.source_items
  where raw_ciphertext is not null;
$$;

revoke all on function public.own_raw_retention_status() from public, anon;
grant execute on function public.own_raw_retention_status() to authenticated, service_role;

-- Immediate purge of encrypted raw payloads. Mirrors purge_expired_raw_payloads, which nulls the
-- encryption columns and keeps the row, so derived facts, classifications, and provenance survive.
create function public.purge_own_raw_payloads()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  affected bigint;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.source_items
  set raw_ciphertext = null,
      raw_nonce = null,
      wrapped_data_key = null,
      wrap_nonce = null,
      key_version = null,
      encryption_environment = null
  where user_id = actor
    and raw_ciphertext is not null;
  get diagnostics affected = row_count;

  insert into public.audit_log (user_id, actor_type, action, target_type, metadata)
  values (
    actor,
    'user',
    'privacy.raw_payloads_purged',
    'source_items',
    jsonb_build_object('purgedCount', affected)
  );

  return affected;
end;
$$;

revoke all on function public.purge_own_raw_payloads() from public, anon;
grant execute on function public.purge_own_raw_payloads() to authenticated, service_role;

create type public.account_deletion_state as enum (
  'requested',
  'connectors_revoked',
  'completed'
);

-- One row per tenant. It cascades with the user, so a finished deletion leaves nothing behind; the
-- state exists to make an interrupted deletion resumable and inspectable while it is in progress.
create table public.account_deletions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state public.account_deletion_state not null default 'requested',
  attempt_count integer not null default 1 check (attempt_count >= 1),
  requested_at timestamptz not null default now(),
  connectors_revoked_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (state <> 'completed' or completed_at is not null),
  check (state = 'requested' or connectors_revoked_at is not null)
);

alter table public.account_deletions enable row level security;
create policy "users view own account deletion" on public.account_deletions
for select using ((select auth.uid()) = user_id);

-- The schema-wide grant in the initial migration only covered tables that existed then, so this
-- table needs its own grants. Read-only for the tenant: the row is created and advanced exclusively
-- through the functions below, never by a direct client write.
grant select on public.account_deletions to authenticated;
grant all on public.account_deletions to service_role;

create trigger account_deletions_set_updated_at before update on public.account_deletions
for each row execute function public.set_updated_at();

-- Requesting deletion is idempotent: repeating it returns the existing record and counts the
-- attempt rather than restarting or duplicating the request.
--
-- Two entry points share one implementation. The API orchestrates deletion with the service role and
-- an explicit, already-authenticated tenant id; an end user (or the mobile client under RLS) reaches
-- the same logic through the auth.uid() wrapper below.
create function public.request_account_deletion(p_user_id uuid)
returns public.account_deletions
language plpgsql
security definer
set search_path = ''
as $$
declare
  deletion public.account_deletions;
begin
  if p_user_id is null then
    raise exception 'Account deletion tenant is required' using errcode = '22023';
  end if;

  insert into public.account_deletions as existing (user_id)
  values (p_user_id)
  on conflict (user_id) do update
    set attempt_count = existing.attempt_count + 1
  returning * into deletion;

  insert into public.audit_log (user_id, actor_type, action, target_type, metadata)
  values (
    p_user_id,
    'user',
    'privacy.account_deletion_requested',
    'account_deletions',
    jsonb_build_object('attemptCount', deletion.attempt_count, 'state', deletion.state)
  );

  return deletion;
end;
$$;

revoke all on function public.request_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid) to service_role;

create function public.request_own_account_deletion()
returns public.account_deletions
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return public.request_account_deletion(actor);
end;
$$;

revoke all on function public.request_own_account_deletion() from public, anon;
grant execute on function public.request_own_account_deletion() to authenticated, service_role;

-- Records that provider-side revocation finished. The API performs the outbound revocation calls,
-- then advances the state here so an interrupted run resumes at the right step.
create function public.mark_account_connectors_revoked(p_user_id uuid)
returns public.account_deletions
language plpgsql
security definer
set search_path = ''
as $$
declare
  deletion public.account_deletions;
begin
  if p_user_id is null then
    raise exception 'Account deletion tenant is required' using errcode = '22023';
  end if;

  update public.account_deletions
  set state = case when state = 'completed' then state else 'connectors_revoked' end,
      connectors_revoked_at = coalesce(connectors_revoked_at, now())
  where user_id = p_user_id
  returning * into deletion;

  if deletion.user_id is null then
    raise exception 'Account deletion was never requested' using errcode = 'P0002';
  end if;

  return deletion;
end;
$$;

revoke all on function public.mark_account_connectors_revoked(uuid)
from public, anon, authenticated;
grant execute on function public.mark_account_connectors_revoked(uuid) to service_role;

-- Database-side finalization. Every step is idempotent so an interrupted deletion can be retried
-- safely. Credential rows are removed here only after the API has revoked them provider-side, so a
-- completed deletion cannot leave an active provider credential behind.
create function public.finalize_account_deletion(p_user_id uuid)
returns public.account_deletions
language plpgsql
security definer
set search_path = ''
as $$
declare
  deletion public.account_deletions;
  cancelled_actions bigint;
  revoked_devices bigint;
  removed_connections bigint;
begin
  if p_user_id is null then
    raise exception 'Account deletion tenant is required' using errcode = '22023';
  end if;

  select * into deletion from public.account_deletions where user_id = p_user_id;
  if deletion.user_id is null then
    raise exception 'Account deletion was never requested' using errcode = 'P0002';
  end if;

  update public.action_runs
  set status = 'cancelled'
  where user_id = p_user_id
    and status in ('proposed', 'awaiting-approval', 'approved', 'running');
  get diagnostics cancelled_actions = row_count;

  update public.devices
  set revoked_at = now()
  where user_id = p_user_id
    and revoked_at is null;
  get diagnostics revoked_devices = row_count;

  -- action_rules.connection_id is ON DELETE RESTRICT, so detach and disable before removing the
  -- credential rows; an enabled rule without a connection could never run correctly anyway.
  update public.action_rules
  set connection_id = null,
      enabled = false
  where user_id = p_user_id
    and connection_id is not null;

  delete from public.connections where user_id = p_user_id;
  get diagnostics removed_connections = row_count;

  update public.source_items
  set raw_ciphertext = null,
      raw_nonce = null,
      wrapped_data_key = null,
      wrap_nonce = null,
      key_version = null,
      encryption_environment = null
  where user_id = p_user_id
    and raw_ciphertext is not null;

  update public.account_deletions
  set state = 'completed',
      connectors_revoked_at = coalesce(connectors_revoked_at, now()),
      completed_at = coalesce(completed_at, now())
  where user_id = p_user_id
  returning * into deletion;

  insert into public.audit_log (user_id, actor_type, action, target_type, metadata)
  values (
    p_user_id,
    'system',
    'privacy.account_deletion_finalized',
    'account_deletions',
    jsonb_build_object(
      'cancelledActionCount', cancelled_actions,
      'revokedDeviceCount', revoked_devices,
      'removedConnectionCount', removed_connections
    )
  );

  return deletion;
end;
$$;

revoke all on function public.finalize_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.finalize_account_deletion(uuid) to service_role;

comment on table public.account_deletions is
  'In-progress account deletion state. Cascades with the user, so a finished deletion leaves nothing.';
