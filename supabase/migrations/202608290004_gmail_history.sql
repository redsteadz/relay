create function public.assert_gmail_mailbox_migration_ready_v1()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.connections
    where provider = 'gmail'
      and status = 'active'
      and (
        external_account_id is null
        or char_length(btrim(external_account_id)) not between 3 and 320
        or btrim(external_account_id) not like '%@%'
        or btrim(external_account_id) ~ '[[:space:][:cntrl:]]'
      )
  ) then
    raise exception 'Active Gmail mailbox ownership is invalid' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.connections
    where provider = 'gmail' and status = 'active'
    group by lower(btrim(external_account_id))
    having count(*) > 1
  ) then
    raise exception 'Active Gmail mailbox ownership is ambiguous' using errcode = '23505';
  end if;
end;
$$;

revoke all on function public.assert_gmail_mailbox_migration_ready_v1()
from public, anon, authenticated, service_role;

select public.assert_gmail_mailbox_migration_ready_v1();

-- Custom-category invariants must block direct deletion of system categories without blocking the
-- auth.users ON DELETE CASCADE used by account deletion. PostgreSQL executes that referential action
-- from a parent trigger, so the category trigger is nested; direct category deletion remains depth 1.
-- Replacing the function here composes the already-ordered category and privacy migrations without
-- rewriting either migration.
create or replace function public.enforce_category_invariants()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_system and current_role = 'authenticated' then
      raise exception 'System categories cannot be created by users' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'Category tenant cannot change' using errcode = '42501';
    end if;
    if new.is_system is distinct from old.is_system then
      raise exception 'Category system flag is immutable' using errcode = '42501';
    end if;
    if old.is_system and new.slug is distinct from old.slug then
      raise exception 'System category slug is immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  if pg_trigger_depth() > 1 then
    return old;
  end if;
  if old.is_system then
    raise exception 'System category cannot be deleted' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.classifications c
    where c.user_id = old.user_id
      and c.category_id = old.id
  ) then
    raise exception 'Category with existing classifications must be archived, not deleted'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

update public.connections
set external_account_id = lower(btrim(external_account_id))
where provider = 'gmail' and status = 'active';

drop policy "users delete own connections" on public.connections;
create policy "users delete own non-active-gmail connections" on public.connections
for delete using (
  (select auth.uid()) = user_id
  and not (provider = 'gmail' and status = 'active')
);

alter table public.connections
add constraint connections_gmail_mailbox_normalized
check (
  provider <> 'gmail'
  or status <> 'active'
  or (
    external_account_id is not null
    and external_account_id = lower(btrim(external_account_id))
    and char_length(external_account_id) between 3 and 320
    and external_account_id like '%@%'
    and external_account_id !~ '[[:space:][:cntrl:]]'
  )
) not valid;

-- Creation intentionally fails if a shared deployment already contains ambiguous active ownership.
-- Operators must resolve those rows explicitly; Relay never chooses a fallback tenant.
create unique index connections_active_gmail_mailbox_unique
on public.connections ((lower(btrim(external_account_id))))
where provider = 'gmail' and status = 'active';

create table public.gmail_connection_state (
  connection_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_email text not null,
  history_cursor text check (history_cursor is null or history_cursor ~ '^(0|[1-9][0-9]*)$'),
  watch_history_id text check (watch_history_id is null or watch_history_id ~ '^(0|[1-9][0-9]*)$'),
  watch_expiration timestamptz,
  watch_renewal_due_at timestamptz not null default now(),
  reconciliation_due_at timestamptz not null default now(),
  last_reconciled_at timestamptz,
  sync_status text not null default 'active' check (sync_status in ('active', 'stale')),
  error_code text check (
    error_code is null
    or error_code in ('continuation-invalid', 'initialization-ambiguous', 'stale-history')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, connection_id),
  foreign key (user_id, connection_id) references public.connections(user_id, id) on delete cascade,
  check (
    normalized_email = lower(btrim(normalized_email))
    and char_length(normalized_email) between 3 and 320
    and normalized_email like '%@%'
    and normalized_email !~ '[[:space:][:cntrl:]]'
  ),
  check (
    (sync_status = 'active' and error_code is null)
    or (
      sync_status = 'stale'
      and error_code in ('continuation-invalid', 'initialization-ambiguous', 'stale-history')
    )
  )
);

create table public.gmail_disconnect_receipts (
  connection_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null unique,
  reason text not null check (reason in ('provider-grant-revoked', 'user-disconnect')),
  watch_stopped boolean not null,
  token_revoked boolean not null,
  provider_already_revoked boolean not null,
  detached_action_rule_count integer not null check (detached_action_rule_count >= 0),
  completed_at timestamptz not null default now(),
  unique (user_id, connection_id),
  check (
    (watch_stopped and token_revoked and not provider_already_revoked)
    or (not watch_stopped and token_revoked and provider_already_revoked)
  )
);

create table public.gmail_disconnect_tombstones (
  mailbox_digest text primary key check (mailbox_digest ~ '^[0-9a-f]{64}$'),
  connection_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (user_id, connection_id),
  check (expires_at > completed_at)
);

create table public.gmail_terminal_message_receipts (
  connection_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  message_digest text not null check (message_digest ~ '^[0-9a-f]{64}$'),
  reason text not null check (
    reason in (
      'provider-message-missing', 'provider-response-invalid',
      'provider-response-too-large', 'queue-budget-exceeded'
    )
  ),
  completed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  primary key (connection_id, message_digest),
  unique (user_id, connection_id, message_digest),
  check (expires_at > completed_at)
);

create index gmail_terminal_message_receipts_expiry_idx
on public.gmail_terminal_message_receipts (expires_at);

insert into public.gmail_connection_state (connection_id, user_id, normalized_email)
select id, user_id, external_account_id
from public.connections
where provider = 'gmail' and status = 'active';

create index gmail_connection_state_maintenance_idx
on public.gmail_connection_state (
  sync_status, watch_renewal_due_at, reconciliation_due_at, connection_id
);

alter table public.gmail_connection_state enable row level security;
create policy "gmail state is service managed" on public.gmail_connection_state
for all to service_role using (true) with check (true);
revoke all on public.gmail_connection_state from public, anon, authenticated;
grant all on public.gmail_connection_state to service_role;

alter table public.gmail_disconnect_receipts enable row level security;
create policy "gmail disconnect receipts are service managed" on public.gmail_disconnect_receipts
for all to service_role using (true) with check (true);
revoke all on public.gmail_disconnect_receipts from public, anon, authenticated;
grant all on public.gmail_disconnect_receipts to service_role;

alter table public.gmail_disconnect_tombstones enable row level security;
create policy "gmail disconnect tombstones are service managed"
on public.gmail_disconnect_tombstones
for all to service_role using (true) with check (true);
revoke all on public.gmail_disconnect_tombstones from public, anon, authenticated;
grant all on public.gmail_disconnect_tombstones to service_role;

alter table public.gmail_terminal_message_receipts enable row level security;
create policy "gmail terminal receipts are service managed"
on public.gmail_terminal_message_receipts
for all to service_role using (true) with check (true);
revoke all on public.gmail_terminal_message_receipts from public, anon, authenticated;
grant all on public.gmail_terminal_message_receipts to service_role;

create function public.create_gmail_connection_v1(
  p_id uuid,
  p_user_id uuid,
  p_normalized_email text,
  p_credential_ciphertext bytea,
  p_credential_nonce bytea,
  p_wrapped_data_key bytea,
  p_wrap_nonce bytea,
  p_key_version integer,
  p_encryption_environment text,
  p_scopes text[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_id is null
    or p_user_id is null
    or p_normalized_email is null
    or p_normalized_email <> lower(btrim(p_normalized_email))
    or char_length(p_normalized_email) not between 3 and 320
    or p_normalized_email not like '%@%'
    or p_normalized_email ~ '[[:space:][:cntrl:]]'
    or p_credential_ciphertext is null
    or octet_length(p_credential_ciphertext) < 16
    or p_credential_nonce is null
    or octet_length(p_credential_nonce) <> 12
    or p_wrapped_data_key is null
    or octet_length(p_wrapped_data_key) <> 48
    or p_wrap_nonce is null
    or octet_length(p_wrap_nonce) <> 12
    or p_key_version is null
    or p_key_version <= 0
    or p_encryption_environment is null
    or p_encryption_environment not in ('development', 'production')
    or p_scopes is null
    or not ('https://www.googleapis.com/auth/gmail.readonly' = any(p_scopes)) then
    raise exception 'Invalid Gmail connection' using errcode = '22023';
  end if;

  insert into public.connections (
    id, user_id, provider, external_account_id, credential_ciphertext, credential_nonce,
    wrapped_data_key, wrap_nonce, key_version, encryption_environment, scopes, status
  ) values (
    p_id, p_user_id, 'gmail', p_normalized_email, p_credential_ciphertext, p_credential_nonce,
    p_wrapped_data_key, p_wrap_nonce, p_key_version, p_encryption_environment, p_scopes, 'active'
  );

  insert into public.gmail_connection_state (connection_id, user_id, normalized_email)
  values (p_id, p_user_id, p_normalized_email);

  return p_id;
end;
$$;

revoke all on function public.create_gmail_connection_v1(
  uuid, uuid, text, bytea, bytea, bytea, bytea, integer, text, text[]
) from public, anon, authenticated;
grant execute on function public.create_gmail_connection_v1(
  uuid, uuid, text, bytea, bytea, bytea, bytea, integer, text, text[]
) to service_role;

create function public.resolve_gmail_connection_v1(p_normalized_email text)
returns table (user_id uuid, connection_id uuid, target_status text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.gmail_disconnect_tombstones where expires_at <= now();

  if p_normalized_email is null
    or p_normalized_email <> lower(btrim(p_normalized_email))
    or char_length(p_normalized_email) not between 3 and 320
    or p_normalized_email not like '%@%'
    or p_normalized_email ~ '[[:space:][:cntrl:]]' then
    return;
  end if;

  return query
  select state.user_id, state.connection_id, 'active'::text as target_status
  from public.gmail_connection_state as state
  join public.connections as connection
    on connection.user_id = state.user_id and connection.id = state.connection_id
  where state.normalized_email = p_normalized_email
    and connection.provider = 'gmail'
    and connection.status = 'active';
  if found then return; end if;

  return query
  select tombstone.user_id, tombstone.connection_id, 'tombstone'::text as target_status
  from public.gmail_disconnect_tombstones as tombstone
  where tombstone.mailbox_digest = encode(
    extensions.digest(p_normalized_email, 'sha256'), 'hex'
  ) and tombstone.expires_at > now();
end;
$$;

revoke all on function public.resolve_gmail_connection_v1(text) from public, anon, authenticated;
grant execute on function public.resolve_gmail_connection_v1(text) to service_role;

create function public.load_gmail_connection_v1(p_user_id uuid, p_connection_id uuid)
returns table (
  credential_ciphertext bytea,
  credential_nonce bytea,
  wrapped_data_key bytea,
  wrap_nonce bytea,
  key_version integer,
  encryption_environment text,
  history_cursor text,
  sync_status text
)
language sql
security invoker
set search_path = ''
as $$
  select
    connection.credential_ciphertext,
    connection.credential_nonce,
    connection.wrapped_data_key,
    connection.wrap_nonce,
    connection.key_version,
    connection.encryption_environment,
    state.history_cursor,
    state.sync_status
  from public.connections as connection
  join public.gmail_connection_state as state
    on state.user_id = connection.user_id and state.connection_id = connection.id
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.provider = 'gmail'
    and connection.status = 'active'
$$;

revoke all on function public.load_gmail_connection_v1(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.load_gmail_connection_v1(uuid, uuid) to service_role;

create function public.gmail_connection_ownership_v1(p_user_id uuid, p_connection_id uuid)
returns text
language sql
security invoker
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.gmail_disconnect_receipts
      where user_id = p_user_id and connection_id = p_connection_id
    ) then 'completed'
    when exists (
      select 1 from public.connections
      where user_id = p_user_id
        and id = p_connection_id
        and provider = 'gmail'
        and status = 'active'
    ) then 'active'
    else 'absent'
  end
$$;

revoke all on function public.gmail_connection_ownership_v1(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.gmail_connection_ownership_v1(uuid, uuid) to service_role;

create function public.list_due_gmail_connections_v1(p_limit integer default 50)
returns table (
  user_id uuid,
  connection_id uuid,
  renew_watch boolean,
  reconcile_history boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid Gmail maintenance limit' using errcode = '22023';
  end if;

  delete from public.gmail_disconnect_tombstones where expires_at <= now();

  return query
  with due as (
    select
      state.user_id,
      state.connection_id,
      (state.watch_renewal_due_at <= now()) as renew_watch,
      (state.reconciliation_due_at <= now()) as reconcile_history
    from public.gmail_connection_state as state
    join public.connections as connection
      on connection.user_id = state.user_id and connection.id = state.connection_id
    where connection.provider = 'gmail'
      and connection.status = 'active'
      and state.sync_status = 'active'
      and (
        state.watch_renewal_due_at <= now()
        or state.reconciliation_due_at <= now()
      )
    order by least(state.watch_renewal_due_at, state.reconciliation_due_at), state.connection_id
    for update of state skip locked
    limit p_limit
  ), claimed as (
    update public.gmail_connection_state as state
    set watch_renewal_due_at = case
          when due.renew_watch then now() + interval '2 hours'
          else state.watch_renewal_due_at
        end,
        reconciliation_due_at = case
          when due.reconcile_history then now() + interval '2 hours'
          else state.reconciliation_due_at
        end,
        updated_at = now()
    from due
    where state.user_id = due.user_id
      and state.connection_id = due.connection_id
    returning due.user_id, due.connection_id, due.renew_watch, due.reconcile_history
  )
  select claimed.user_id, claimed.connection_id,
    claimed.renew_watch, claimed.reconcile_history
  from claimed
  order by claimed.connection_id;
end;
$$;

revoke all on function public.list_due_gmail_connections_v1(integer)
from public, anon, authenticated;
grant execute on function public.list_due_gmail_connections_v1(integer) to service_role;

create function public.set_gmail_history_baseline_v1(
  p_user_id uuid,
  p_connection_id uuid,
  p_history_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_history_id is null or p_history_id !~ '^(0|[1-9][0-9]*)$' then
    raise exception 'Invalid Gmail cursor' using errcode = '22023';
  end if;

  update public.gmail_connection_state as state
  set history_cursor = p_history_id,
      reconciliation_due_at = now() + interval '1 hour',
      updated_at = now()
  from public.connections as connection
  where state.user_id = p_user_id
    and state.connection_id = p_connection_id
    and state.history_cursor is null
    and state.sync_status = 'active'
    and connection.user_id = state.user_id
    and connection.id = state.connection_id
    and connection.provider = 'gmail'
    and connection.status = 'active';
  get diagnostics affected = row_count;
  if affected = 1 then return true; end if;

  return exists (
    select 1 from public.gmail_connection_state as state
    join public.connections as connection
      on connection.user_id = state.user_id and connection.id = state.connection_id
    where state.user_id = p_user_id
      and state.connection_id = p_connection_id
      and state.history_cursor = p_history_id
      and state.sync_status = 'active'
      and connection.provider = 'gmail'
      and connection.status = 'active'
  );
end;
$$;

revoke all on function public.set_gmail_history_baseline_v1(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.set_gmail_history_baseline_v1(uuid, uuid, text) to service_role;

create function public.advance_gmail_history_cursor_v1(
  p_user_id uuid,
  p_connection_id uuid,
  p_expected_history_id text,
  p_new_history_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_history_id text;
begin
  if p_expected_history_id is null
    or p_expected_history_id !~ '^(0|[1-9][0-9]*)$'
    or p_new_history_id is null
    or p_new_history_id !~ '^(0|[1-9][0-9]*)$'
    or p_new_history_id::numeric < p_expected_history_id::numeric then
    raise exception 'Invalid Gmail cursor' using errcode = '22023';
  end if;

  select state.history_cursor into current_history_id
  from public.gmail_connection_state as state
  join public.connections as connection
    on connection.user_id = state.user_id and connection.id = state.connection_id
  where state.user_id = p_user_id
    and state.connection_id = p_connection_id
    and state.sync_status = 'active'
    and connection.provider = 'gmail'
    and connection.status = 'active'
  for update of state;

  if not found or current_history_id is null then return false; end if;
  if current_history_id = p_new_history_id then return true; end if;
  if current_history_id <> p_expected_history_id then return false; end if;

  update public.gmail_connection_state
  set history_cursor = p_new_history_id,
      last_reconciled_at = now(),
      reconciliation_due_at = now() + interval '1 hour',
      updated_at = now()
  where user_id = p_user_id and connection_id = p_connection_id;
  return true;
end;
$$;

revoke all on function public.advance_gmail_history_cursor_v1(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.advance_gmail_history_cursor_v1(uuid, uuid, text, text)
to service_role;

create function public.record_gmail_watch_v1(
  p_user_id uuid,
  p_connection_id uuid,
  p_history_id text,
  p_expiration timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_history_id is null
    or p_history_id !~ '^(0|[1-9][0-9]*)$'
    or p_expiration is null
    or p_expiration <= now()
    or p_expiration > now() + interval '7 days 5 minutes' then
    raise exception 'Invalid Gmail watch' using errcode = '22023';
  end if;

  update public.gmail_connection_state as state
  set watch_history_id = p_history_id,
      watch_expiration = p_expiration,
      watch_renewal_due_at = least(p_expiration - interval '2 days', now() + interval '1 day'),
      updated_at = now()
  from public.connections as connection
  where state.user_id = p_user_id
    and state.connection_id = p_connection_id
    and connection.user_id = state.user_id
    and connection.id = state.connection_id
    and connection.provider = 'gmail'
    and connection.status = 'active';
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.record_gmail_watch_v1(uuid, uuid, text, timestamptz)
from public, anon, authenticated;
grant execute on function public.record_gmail_watch_v1(uuid, uuid, text, timestamptz)
to service_role;

create function public.mark_gmail_resync_required_v1(
  p_user_id uuid,
  p_connection_id uuid,
  p_error_code text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_error_code is null
    or p_error_code not in (
      'continuation-invalid', 'initialization-ambiguous', 'stale-history'
    ) then
    raise exception 'Invalid Gmail resync reason' using errcode = '22023';
  end if;

  update public.gmail_connection_state as state
  set sync_status = 'stale', error_code = p_error_code, updated_at = now()
  from public.connections as connection
  where state.user_id = p_user_id
    and state.connection_id = p_connection_id
    and connection.user_id = state.user_id
    and connection.id = state.connection_id
    and connection.provider = 'gmail'
    and connection.status = 'active';
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.mark_gmail_resync_required_v1(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.mark_gmail_resync_required_v1(uuid, uuid, text) to service_role;

create function public.disconnect_gmail_connection_v1(
  p_user_id uuid,
  p_connection_id uuid,
  p_action_id uuid,
  p_reason text,
  p_watch_stopped boolean,
  p_token_revoked boolean,
  p_provider_already_revoked boolean,
  p_pubsub_retention_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  detached_action_rules integer;
  mailbox text;
  watch_expires_at timestamptz;
begin
  if p_action_id is null
    or p_reason is null
    or p_reason not in ('provider-grant-revoked', 'user-disconnect')
    or p_watch_stopped is null
    or p_token_revoked is null
    or p_provider_already_revoked is null
    or p_pubsub_retention_seconds is null
    or p_pubsub_retention_seconds not between 600 and 2678400
    or not p_token_revoked
    or not (
      (p_watch_stopped and not p_provider_already_revoked)
      or (not p_watch_stopped and p_provider_already_revoked)
    ) then
    raise exception 'Invalid Gmail disconnect evidence' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.gmail_disconnect_receipts
    where user_id = p_user_id
      and connection_id = p_connection_id
      and action_id = p_action_id
      and reason = p_reason
      and watch_stopped = p_watch_stopped
      and token_revoked = p_token_revoked
      and provider_already_revoked = p_provider_already_revoked
  ) then
    return true;
  end if;

  select state.normalized_email, state.watch_expiration into mailbox, watch_expires_at
  from public.connections as connection
  join public.gmail_connection_state as state
    on state.user_id = connection.user_id and state.connection_id = connection.id
  where connection.user_id = p_user_id
    and connection.id = p_connection_id
    and connection.provider = 'gmail'
    and connection.status = 'active'
  for update of connection, state;
  if not found then
    return exists (
      select 1 from public.gmail_disconnect_receipts
      where user_id = p_user_id
        and connection_id = p_connection_id
        and action_id = p_action_id
        and reason = p_reason
        and watch_stopped = p_watch_stopped
        and token_revoked = p_token_revoked
        and provider_already_revoked = p_provider_already_revoked
    );
  end if;

  update public.action_rules
  set enabled = false,
      connection_id = null,
      updated_at = now()
  where user_id = p_user_id and connection_id = p_connection_id;
  get diagnostics detached_action_rules = row_count;

  insert into public.gmail_disconnect_receipts (
    connection_id, user_id, action_id, reason, watch_stopped, token_revoked,
    provider_already_revoked, detached_action_rule_count
  ) values (
    p_connection_id, p_user_id, p_action_id, p_reason, p_watch_stopped, p_token_revoked,
    p_provider_already_revoked, detached_action_rules
  );

  insert into public.gmail_disconnect_tombstones (
    mailbox_digest, connection_id, user_id, expires_at
  ) values (
    encode(extensions.digest(mailbox, 'sha256'), 'hex'), p_connection_id, p_user_id,
    greatest(now(), coalesce(watch_expires_at, now()))
      + make_interval(secs => p_pubsub_retention_seconds)
  )
  on conflict (mailbox_digest) do update
  set connection_id = excluded.connection_id,
      user_id = excluded.user_id,
      completed_at = now(),
      expires_at = excluded.expires_at;

  delete from public.connections
  where user_id = p_user_id and id = p_connection_id and provider = 'gmail';

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    case when p_reason = 'user-disconnect' then 'user' else 'connector' end,
    case when p_reason = 'user-disconnect' then p_user_id::text else p_connection_id::text end,
    case when p_reason = 'user-disconnect' then 'connector.disconnected' else 'connector.revoked' end,
    'connection',
    p_connection_id::text, jsonb_build_object(
      'actionId', p_action_id,
      'detachedActionRuleCount', detached_action_rules,
      'provider', 'gmail',
      'providerAlreadyRevoked', p_provider_already_revoked,
      'reason', p_reason,
      'tokenRevoked', p_token_revoked,
      'watchStopped', p_watch_stopped
    )
  );
  return true;
end;
$$;

revoke all on function public.disconnect_gmail_connection_v1(
  uuid, uuid, uuid, text, boolean, boolean, boolean, integer
)
from public, anon, authenticated;
grant execute on function public.disconnect_gmail_connection_v1(
  uuid, uuid, uuid, text, boolean, boolean, boolean, integer
) to service_role;

create function public.record_gmail_terminal_message_v1(
  p_user_id uuid,
  p_connection_id uuid,
  p_message_digest text,
  p_reason text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  if p_message_digest is null
    or p_message_digest !~ '^[0-9a-f]{64}$'
    or p_reason is null
    or p_reason not in (
      'provider-message-missing', 'provider-response-invalid',
      'provider-response-too-large', 'queue-budget-exceeded'
    ) then
    raise exception 'Invalid Gmail terminal message receipt' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.gmail_terminal_message_receipts
    where user_id = p_user_id
      and connection_id = p_connection_id
      and message_digest = p_message_digest
  ) then
    return true;
  end if;

  if not exists (
    select 1 from public.connections
    where user_id = p_user_id
      and id = p_connection_id
      and provider = 'gmail'
      and status = 'active'
  ) then
    return false;
  end if;

  insert into public.gmail_terminal_message_receipts (
    connection_id, user_id, message_digest, reason
  ) values (
    p_connection_id, p_user_id, p_message_digest, p_reason
  ) on conflict (connection_id, message_digest) do nothing;
  get diagnostics inserted = row_count;

  if inserted = 1 then
    insert into public.audit_log (
      user_id, actor_type, actor_id, action, target_type, target_id, metadata
    ) values (
      p_user_id, 'connector', p_connection_id::text, 'gmail.message.terminal', 'connection',
      p_connection_id::text, jsonb_build_object(
        'messageDigest', p_message_digest,
        'reason', p_reason
      )
    );
    return true;
  end if;

  return exists (
    select 1 from public.gmail_terminal_message_receipts
    where user_id = p_user_id
      and connection_id = p_connection_id
      and message_digest = p_message_digest
  );
end;
$$;

revoke all on function public.record_gmail_terminal_message_v1(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.record_gmail_terminal_message_v1(uuid, uuid, text, text)
to service_role;

create function public.persist_encrypted_source_item_v4(
  p_id uuid,
  p_user_id uuid,
  p_connection_id uuid,
  p_source public.source_kind,
  p_source_account_id text,
  p_external_id text,
  p_application_id text,
  p_occurred_at timestamptz,
  p_captured_at timestamptz,
  p_content_fingerprint text,
  p_fact_set_fingerprint text,
  p_accepted_at timestamptz,
  p_raw_expires_at timestamptz,
  p_encryption_environment text,
  p_raw_ciphertext bytea,
  p_raw_nonce bytea,
  p_wrapped_data_key bytea,
  p_wrap_nonce bytea,
  p_key_version integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  result text;
  stored_connection_id uuid;
begin
  if p_connection_id is null
    or p_source <> 'gmail'
    or p_source_account_id is distinct from p_connection_id::text
    or not exists (
      select 1 from public.connections
      where user_id = p_user_id
        and id = p_connection_id
        and provider = 'gmail'
        and status = 'active'
    ) then
    return 'tenant-conflict';
  end if;

  result = public.persist_encrypted_source_item_v3(
    p_id, p_user_id, p_source, p_source_account_id, p_external_id, p_application_id,
    p_occurred_at, p_captured_at, p_content_fingerprint, p_fact_set_fingerprint,
    p_accepted_at, p_raw_expires_at, p_encryption_environment, p_raw_ciphertext,
    p_raw_nonce, p_wrapped_data_key, p_wrap_nonce, p_key_version
  );

  if result not in ('stored', 'duplicate') then return result; end if;

  select connection_id into stored_connection_id
  from public.source_items
  where id = p_id and user_id = p_user_id
  for update;

  if not found then return result; end if;
  if stored_connection_id is not null and stored_connection_id <> p_connection_id then
    return 'fact-integrity-conflict';
  end if;

  update public.source_items
  set connection_id = p_connection_id
  where id = p_id and user_id = p_user_id and connection_id is null;
  return result;
end;
$$;

revoke all on function public.persist_encrypted_source_item_v4(
  uuid, uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer
) from public, anon, authenticated;
grant execute on function public.persist_encrypted_source_item_v4(
  uuid, uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer
) to service_role;

create or replace function public.purge_expired_raw_payloads(p_now timestamptz default now())
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected bigint;
  dead_letter_affected bigint;
  gmail_receipt_affected bigint;
  gmail_tombstone_affected bigint;
begin
  update public.source_items
  set raw_ciphertext = null,
      raw_nonce = null,
      wrapped_data_key = null,
      wrap_nonce = null,
      key_version = null,
      encryption_environment = null
  where raw_expires_at <= p_now and raw_ciphertext is not null;
  get diagnostics affected = row_count;

  update public.dead_letter_items
  set status = 'expired',
      encryption_environment = null,
      ciphertext = null,
      nonce = null,
      wrapped_data_key = null,
      wrap_nonce = null,
      key_version = null,
      replay_request_id = null,
      completed_at = coalesce(completed_at, p_now)
  where raw_expires_at <= p_now and ciphertext is not null;
  get diagnostics dead_letter_affected = row_count;

  delete from public.gmail_terminal_message_receipts where expires_at <= p_now;
  get diagnostics gmail_receipt_affected = row_count;

  delete from public.gmail_disconnect_tombstones where expires_at <= p_now;
  get diagnostics gmail_tombstone_affected = row_count;

  return affected + dead_letter_affected + gmail_receipt_affected + gmail_tombstone_affected;
end;
$$;
