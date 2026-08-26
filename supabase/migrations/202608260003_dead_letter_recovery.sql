create function public.persist_encrypted_source_item_v2(
  p_id uuid,
  p_user_id uuid,
  p_source public.source_kind,
  p_source_account_id text,
  p_external_id text,
  p_application_id text,
  p_occurred_at timestamptz,
  p_captured_at timestamptz,
  p_content_fingerprint text,
  p_accepted_at timestamptz,
  p_raw_expires_at timestamptz,
  p_encryption_environment text,
  p_raw_ciphertext bytea,
  p_raw_nonce bytea,
  p_wrapped_data_key bytea,
  p_wrap_nonce bytea,
  p_key_version integer
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_id is null
    or p_user_id is null
    or p_source is null
    or p_external_id is null
    or p_external_id = ''
    or p_occurred_at is null
    or p_captured_at is null
    or p_content_fingerprint is null
    or p_content_fingerprint !~ '^[0-9a-f]{64}$'
    or p_accepted_at is null
    or p_accepted_at > now() + interval '5 minutes'
    or p_raw_expires_at <> p_accepted_at + interval '7 days'
    or p_raw_expires_at <= now()
    or p_encryption_environment is null
    or p_encryption_environment not in ('development', 'production')
    or p_raw_ciphertext is null
    or octet_length(p_raw_ciphertext) < 16
    or p_raw_nonce is null
    or octet_length(p_raw_nonce) <> 12
    or p_wrapped_data_key is null
    or octet_length(p_wrapped_data_key) <> 48
    or p_wrap_nonce is null
    or octet_length(p_wrap_nonce) <> 12
    or p_key_version is null
    or p_key_version <= 0 then
    raise exception 'Invalid encrypted source item' using errcode = '22023';
  end if;

  insert into public.source_items (
    id,
    user_id,
    source,
    source_account_id,
    external_id,
    application_id,
    occurred_at,
    captured_at,
    content_fingerprint,
    raw_expires_at,
    encryption_environment,
    raw_ciphertext,
    raw_nonce,
    wrapped_data_key,
    wrap_nonce,
    key_version
  ) values (
    p_id,
    p_user_id,
    p_source,
    p_source_account_id,
    p_external_id,
    p_application_id,
    p_occurred_at,
    p_captured_at,
    p_content_fingerprint,
    p_raw_expires_at,
    p_encryption_environment,
    p_raw_ciphertext,
    p_raw_nonce,
    p_wrapped_data_key,
    p_wrap_nonce,
    p_key_version
  )
  on conflict do nothing;

  get diagnostics affected = row_count;
  if affected = 1 then
    return true;
  end if;

  if exists (
    select 1
    from public.source_items
    where user_id = p_user_id
      and (
        id = p_id
        or (
          source = p_source
          and source_account_id is not distinct from p_source_account_id
          and external_id = p_external_id
        )
        or content_fingerprint = p_content_fingerprint
      )
  ) then
    return false;
  end if;

  raise exception 'Encrypted source item conflicts outside tenant' using errcode = '23505';
end;
$$;

revoke all on function public.persist_encrypted_source_item_v2(
  uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, timestamptz,
  timestamptz, text, bytea, bytea, bytea, bytea, integer
) from public, anon, authenticated;
grant execute on function public.persist_encrypted_source_item_v2(
  uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, timestamptz,
  timestamptz, text, bytea, bytea, bytea, bytea, integer
) to service_role;

create table public.dead_letter_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  envelope_id uuid not null,
  failure_code text not null check (failure_code in (
    'configuration_invalid',
    'key_version_unavailable',
    'ciphertext_invalid',
    'envelope_invalid',
    'persistence_unavailable',
    'tenant_id_conflict',
    'persistence_response_invalid',
    'coordinator_unavailable',
    'retry_exhausted_unknown'
  )),
  status text not null default 'available' check (status in (
    'available', 'replaying', 'succeeded', 'duplicate', 'expired'
  )),
  accepted_at timestamptz not null,
  raw_expires_at timestamptz not null,
  encryption_environment text check (encryption_environment in ('development', 'production')),
  ciphertext bytea,
  nonce bytea,
  wrapped_data_key bytea,
  wrap_nonce bytea,
  key_version integer check (key_version > 0),
  replay_request_id uuid,
  replay_count integer not null default 0 check (replay_count >= 0),
  first_failed_at timestamptz not null default now(),
  last_failed_at timestamptz not null default now(),
  last_replayed_at timestamptz,
  completed_at timestamptz,
  unique (user_id, envelope_id),
  check (raw_expires_at = accepted_at + interval '7 days'),
  check (
    (
      ciphertext is null
      and nonce is null
      and wrapped_data_key is null
      and wrap_nonce is null
      and key_version is null
      and encryption_environment is null
    )
    or
    (
      ciphertext is not null
      and nonce is not null
      and wrapped_data_key is not null
      and wrap_nonce is not null
      and key_version is not null
      and encryption_environment is not null
    )
  )
);

create index dead_letter_items_status_failed_idx
on public.dead_letter_items (status, last_failed_at desc);

create index dead_letter_items_expiry_idx
on public.dead_letter_items (raw_expires_at)
where ciphertext is not null;

create index dead_letter_items_kek_inventory_idx
on public.dead_letter_items (encryption_environment, key_version, id)
where ciphertext is not null;

alter table public.dead_letter_items enable row level security;
revoke all on table public.dead_letter_items from public, anon, authenticated;
grant select, insert, update on table public.dead_letter_items to service_role;
create policy "clients cannot access dead-letter recovery" on public.dead_letter_items
as restrictive for all to anon, authenticated using (false) with check (false);

create function public.record_dead_letter_item(
  p_id uuid,
  p_user_id uuid,
  p_envelope_id uuid,
  p_failure_code text,
  p_accepted_at timestamptz,
  p_raw_expires_at timestamptz,
  p_encryption_environment text,
  p_ciphertext bytea,
  p_nonce bytea,
  p_wrapped_data_key bytea,
  p_wrap_nonce bytea,
  p_key_version integer,
  p_replay_request_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
  is_expired boolean := p_raw_expires_at <= now();
begin
  if p_id is null
    or p_user_id is null
    or p_envelope_id is null
    or p_failure_code not in (
      'configuration_invalid', 'key_version_unavailable', 'ciphertext_invalid',
      'envelope_invalid', 'persistence_unavailable', 'tenant_id_conflict',
      'persistence_response_invalid', 'coordinator_unavailable', 'retry_exhausted_unknown'
    )
    or p_accepted_at is null
    or p_raw_expires_at <> p_accepted_at + interval '7 days'
    or p_encryption_environment not in ('development', 'production')
    or p_ciphertext is null
    or octet_length(p_ciphertext) < 16
    or p_nonce is null
    or octet_length(p_nonce) <> 12
    or p_wrapped_data_key is null
    or octet_length(p_wrapped_data_key) <> 48
    or p_wrap_nonce is null
    or octet_length(p_wrap_nonce) <> 12
    or p_key_version is null
    or p_key_version <= 0 then
    raise exception 'Invalid dead-letter item' using errcode = '22023';
  end if;

  insert into public.dead_letter_items (
    id, user_id, envelope_id, failure_code, status, accepted_at, raw_expires_at,
    encryption_environment, ciphertext, nonce, wrapped_data_key, wrap_nonce, key_version
  ) values (
    p_id,
    p_user_id,
    p_envelope_id,
    p_failure_code,
    case when is_expired then 'expired' else 'available' end,
    p_accepted_at,
    p_raw_expires_at,
    case when is_expired then null else p_encryption_environment end,
    case when is_expired then null else p_ciphertext end,
    case when is_expired then null else p_nonce end,
    case when is_expired then null else p_wrapped_data_key end,
    case when is_expired then null else p_wrap_nonce end,
    case when is_expired then null else p_key_version end
  )
  on conflict (id) do update
  set failure_code = case
        when dead_letter_items.failure_code <> 'retry_exhausted_unknown'
          and excluded.failure_code = 'retry_exhausted_unknown'
        then dead_letter_items.failure_code
        else excluded.failure_code
      end,
      status = case when is_expired then 'expired' else dead_letter_items.status end,
      encryption_environment = case
        when is_expired then null else dead_letter_items.encryption_environment
      end,
      ciphertext = case when is_expired then null else dead_letter_items.ciphertext end,
      nonce = case when is_expired then null else dead_letter_items.nonce end,
      wrapped_data_key = case when is_expired then null else dead_letter_items.wrapped_data_key end,
      wrap_nonce = case when is_expired then null else dead_letter_items.wrap_nonce end,
      key_version = case when is_expired then null else dead_letter_items.key_version end,
      replay_request_id = case
        when is_expired then null else dead_letter_items.replay_request_id
      end,
      last_failed_at = now(),
      completed_at = case when is_expired then now() else dead_letter_items.completed_at end
  where dead_letter_items.user_id = excluded.user_id
    and dead_letter_items.envelope_id = excluded.envelope_id
    and dead_letter_items.accepted_at = excluded.accepted_at
    and dead_letter_items.raw_expires_at = excluded.raw_expires_at
    and (
      (
        is_expired
        and dead_letter_items.status in ('available', 'replaying')
      )
      or
      (
        not is_expired
        and (
          (
            p_replay_request_id is not null
            and dead_letter_items.status = 'replaying'
            and dead_letter_items.replay_request_id = p_replay_request_id
          )
        )
      )
    );

  get diagnostics affected = row_count;
  if affected <> 1 then
    if exists (
      select 1
      from public.dead_letter_items
      where id = p_id
        and user_id = p_user_id
        and envelope_id = p_envelope_id
        and accepted_at = p_accepted_at
        and raw_expires_at = p_raw_expires_at
    ) then
      return false;
    end if;
    raise exception 'Dead-letter identity conflict' using errcode = '23505';
  end if;

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    'system',
    'pipeline',
    case
      when is_expired then 'dead_letter.expired'
      when p_replay_request_id is not null then 'dead_letter.replay_failed'
      else 'dead_letter.recorded'
    end,
    'dead_letter_item',
    p_id::text,
    jsonb_build_object('failureCode', p_failure_code)
  );

  return not is_expired;
end;
$$;

create function public.list_dead_letter_items(p_limit integer default 100)
returns table (
  id uuid,
  envelope_id uuid,
  failure_code text,
  status text,
  accepted_at timestamptz,
  raw_expires_at timestamptz,
  key_version integer,
  replay_count integer,
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  last_replayed_at timestamptz,
  completed_at timestamptz
)
language sql
volatile
security invoker
set search_path = ''
as $$
  update public.dead_letter_items as item
  set status = 'expired',
      encryption_environment = null,
      ciphertext = null,
      nonce = null,
      wrapped_data_key = null,
      wrap_nonce = null,
      key_version = null,
      replay_request_id = null,
      completed_at = coalesce(item.completed_at, now())
  where item.raw_expires_at <= now()
    and item.ciphertext is not null;

  select
    dead_letter_items.id,
    dead_letter_items.envelope_id,
    dead_letter_items.failure_code,
    dead_letter_items.status,
    dead_letter_items.accepted_at,
    dead_letter_items.raw_expires_at,
    dead_letter_items.key_version,
    dead_letter_items.replay_count,
    dead_letter_items.first_failed_at,
    dead_letter_items.last_failed_at,
    dead_letter_items.last_replayed_at,
    dead_letter_items.completed_at
  from public.dead_letter_items
  order by dead_letter_items.last_failed_at desc, dead_letter_items.id
  limit least(greatest(p_limit, 1), 100);
$$;

create function public.claim_dead_letter_replay(p_id uuid, p_request_id uuid)
returns table (
  id uuid,
  user_id uuid,
  envelope_id uuid,
  accepted_at timestamptz,
  raw_expires_at timestamptz,
  encryption_environment text,
  ciphertext bytea,
  nonce bytea,
  wrapped_data_key bytea,
  wrap_nonce bytea,
  key_version integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed public.dead_letter_items;
  newly_claimed boolean;
begin
  if p_id is null or p_request_id is null then
    raise exception 'Invalid replay claim' using errcode = '22023';
  end if;

  update public.dead_letter_items as item
  set status = 'expired',
      encryption_environment = null,
      ciphertext = null,
      nonce = null,
      wrapped_data_key = null,
      wrap_nonce = null,
      key_version = null,
      replay_request_id = null,
      completed_at = coalesce(item.completed_at, now())
  where item.id = p_id
    and item.raw_expires_at <= now()
    and item.ciphertext is not null;

  update public.dead_letter_items as item
  set status = 'replaying',
      replay_request_id = p_request_id,
      replay_count = item.replay_count + 1,
      last_replayed_at = now()
  where item.id = p_id
    and item.status = 'available'
    and item.raw_expires_at > now()
    and item.ciphertext is not null
  returning item.* into claimed;
  newly_claimed := found;

  if not found then
    select * into claimed
    from public.dead_letter_items as item
    where item.id = p_id
      and item.status = 'replaying'
      and item.replay_request_id = p_request_id
      and item.raw_expires_at > now()
      and item.ciphertext is not null;
  end if;

  if claimed.id is null then
    return;
  end if;

  if newly_claimed then
    insert into public.audit_log (
      user_id, actor_type, actor_id, action, target_type, target_id, metadata
    ) values (
      claimed.user_id,
      'system',
      'recovery-api',
      'dead_letter.replay_requested',
      'dead_letter_item',
      claimed.id::text,
      jsonb_build_object('requestId', p_request_id)
    );
  end if;

  return query select
    claimed.id,
    claimed.user_id,
    claimed.envelope_id,
    claimed.accepted_at,
    claimed.raw_expires_at,
    claimed.encryption_environment,
    claimed.ciphertext,
    claimed.nonce,
    claimed.wrapped_data_key,
    claimed.wrap_nonce,
    claimed.key_version;
end;
$$;

create function public.release_dead_letter_replay(p_id uuid, p_request_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  update public.dead_letter_items
  set status = 'available',
      replay_request_id = null
  where id = p_id
    and status = 'replaying'
    and replay_request_id = p_request_id
    and raw_expires_at > now()
    and ciphertext is not null;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create function public.complete_dead_letter_replay(
  p_id uuid,
  p_request_id uuid,
  p_result text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  completed public.dead_letter_items;
begin
  if p_result not in ('succeeded', 'duplicate') then
    raise exception 'Invalid replay result' using errcode = '22023';
  end if;

  update public.dead_letter_items
  set status = p_result,
      encryption_environment = null,
      ciphertext = null,
      nonce = null,
      wrapped_data_key = null,
      wrap_nonce = null,
      key_version = null,
      completed_at = now()
  where id = p_id
    and status = 'replaying'
    and replay_request_id = p_request_id
  returning * into completed;

  if not found then
    return exists (
      select 1
      from public.dead_letter_items
      where id = p_id
        and replay_request_id = p_request_id
        and status in ('succeeded', 'duplicate')
        and ciphertext is null
    );
  end if;

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    completed.user_id,
    'system',
    'pipeline',
    'dead_letter.replay_completed',
    'dead_letter_item',
    completed.id::text,
    jsonb_build_object('requestId', p_request_id, 'result', p_result)
  );

  return true;
end;
$$;

create or replace function public.purge_expired_raw_payloads(p_now timestamptz default now())
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected bigint;
  dead_letter_affected bigint;
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

  return affected + dead_letter_affected;
end;
$$;

create or replace function public.kek_encryption_inventory(p_environment text)
returns table (store text, key_version integer, row_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select 'connections'::text, connections.key_version, count(*)::bigint
  from public.connections
  where connections.encryption_environment = p_environment
  group by connections.key_version
  union all
  select 'source_items'::text, source_items.key_version, count(*)::bigint
  from public.source_items
  where source_items.encryption_environment = p_environment
    and source_items.raw_ciphertext is not null
  group by source_items.key_version
  union all
  select 'dead_letter_items'::text, dead_letter_items.key_version, count(*)::bigint
  from public.dead_letter_items
  where dead_letter_items.encryption_environment = p_environment
    and dead_letter_items.ciphertext is not null
  group by dead_letter_items.key_version
  order by 1, 2;
$$;

create function public.cas_rewrap_dead_letter_data_key(
  p_environment text,
  p_id uuid,
  p_user_id uuid,
  p_expected_key_version integer,
  p_expected_wrapped_data_key bytea,
  p_expected_wrap_nonce bytea,
  p_expected_ciphertext bytea,
  p_expected_payload_nonce bytea,
  p_new_key_version integer,
  p_new_wrapped_data_key bytea,
  p_new_wrap_nonce bytea
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_environment not in ('development', 'production')
    or p_new_key_version <= p_expected_key_version
    or octet_length(p_new_wrapped_data_key) <> 48
    or octet_length(p_new_wrap_nonce) <> 12 then
    raise exception 'Invalid dead-letter rewrap request' using errcode = '22023';
  end if;

  update public.dead_letter_items
  set wrapped_data_key = p_new_wrapped_data_key,
      wrap_nonce = p_new_wrap_nonce,
      key_version = p_new_key_version
  where id = p_id
    and user_id = p_user_id
    and encryption_environment = p_environment
    and key_version = p_expected_key_version
    and wrapped_data_key = p_expected_wrapped_data_key
    and wrap_nonce = p_expected_wrap_nonce
    and ciphertext = p_expected_ciphertext
    and nonce = p_expected_payload_nonce;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.record_dead_letter_item(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer, uuid
) from public, anon, authenticated;
revoke all on function public.list_dead_letter_items(integer) from public, anon, authenticated;
revoke all on function public.claim_dead_letter_replay(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_dead_letter_replay(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_dead_letter_replay(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.cas_rewrap_dead_letter_data_key(
  text, uuid, uuid, integer, bytea, bytea, bytea, bytea, integer, bytea, bytea
) from public, anon, authenticated;

grant execute on function public.record_dead_letter_item(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer, uuid
) to service_role;
grant execute on function public.list_dead_letter_items(integer) to service_role;
grant execute on function public.claim_dead_letter_replay(uuid, uuid) to service_role;
grant execute on function public.release_dead_letter_replay(uuid, uuid) to service_role;
grant execute on function public.complete_dead_letter_replay(uuid, uuid, text) to service_role;
grant execute on function public.cas_rewrap_dead_letter_data_key(
  text, uuid, uuid, integer, bytea, bytea, bytea, bytea, integer, bytea, bytea
) to service_role;
