-- Re-recording one dead-letter item is idempotent, not a conflict.
--
-- A recovery ID is the envelope ID, so redelivering an envelope that already dead-lettered calls
-- this function again. The identity check additionally required `accepted_at` and `raw_expires_at`
-- to match, and a later delivery is accepted at a later time, so the row was found by primary key
-- yet failed the check and raised 23505. The queue message never completed and was redelivered,
-- which turned one rejected envelope into a sustained stream of errors against this database.
--
-- Identity is the recovery ID, its owner, and its envelope. Those still disagreeing is a real
-- conflict and still raises. A differing acceptance time is the same item arriving again, so the
-- function reports that it is already recorded.
--
-- Retention is unaffected: the early return leaves the stored acceptance and expiry untouched, so a
-- redelivery cannot restart the seven-day window, matching the queue replay rule in
-- docs/security/privacy.md.

create or replace function public.record_dead_letter_item(
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
  p_replay_request_id uuid,
  p_encryption_aad_user_id text default null,
  p_encryption_aad_envelope_id text default null
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
      'fact_integrity_conflict', 'event_integrity_conflict', 'persistence_response_invalid',
      'coordinator_unavailable', 'retry_exhausted_unknown'
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
    or p_key_version <= 0
    or (p_encryption_aad_user_id is null) <> (p_encryption_aad_envelope_id is null)
    or (
      p_encryption_aad_user_id is not null
      and (
        p_encryption_aad_user_id !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$'
        or p_encryption_aad_envelope_id !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$'
        or lower(p_encryption_aad_user_id) <> p_user_id::text
        or lower(p_encryption_aad_envelope_id) <> p_envelope_id::text
      )
    ) then
    raise exception 'Invalid dead-letter item' using errcode = '22023';
  end if;

  insert into public.dead_letter_items (
    id, user_id, envelope_id, failure_code, status, accepted_at, raw_expires_at,
    encryption_environment, ciphertext, nonce, wrapped_data_key, wrap_nonce, key_version,
    encryption_aad_user_id, encryption_aad_envelope_id
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
    case when is_expired then null else p_key_version end,
    p_encryption_aad_user_id,
    p_encryption_aad_envelope_id
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
    and (
      dead_letter_items.encryption_aad_user_id is null
      or dead_letter_items.encryption_aad_user_id = excluded.encryption_aad_user_id
    )
    and (
      dead_letter_items.encryption_aad_envelope_id is null
      or dead_letter_items.encryption_aad_envelope_id = excluded.encryption_aad_envelope_id
    )
    and dead_letter_items.accepted_at = excluded.accepted_at
    and dead_letter_items.raw_expires_at = excluded.raw_expires_at
    and (
      (is_expired and dead_letter_items.status in ('available', 'replaying'))
      or
      (
        not is_expired
        and p_replay_request_id is not null
        and dead_letter_items.status = 'replaying'
        and dead_letter_items.replay_request_id = p_replay_request_id
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
