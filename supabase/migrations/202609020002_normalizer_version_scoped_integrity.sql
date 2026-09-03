-- Rollout safety for normalizer version 2.
--
-- `source_items.fact_set_fingerprint` is a digest of the whole normalizer output, so bumping the
-- normalizer necessarily changes it. Comparing a v2 digest against a stored v1 digest made a
-- routine Queue retry across a deploy look like data corruption and dead-letter the message.
--
-- The version that produced a stored digest is now recorded alongside it, and the integrity check
-- compares digests only within one version. Differing output under the same version remains an
-- integrity failure exactly as before; differing output across a bump leaves the stored row alone
-- and reports the retry as a duplicate.
--
-- Existing rows predate the column and were all produced by version 1, which is what the backfill
-- and the `coalesce(..., 1)` in the check both assume.

alter table public.source_items
add column fact_set_normalizer_version integer
check (fact_set_normalizer_version is null or fact_set_normalizer_version > 0);

update public.source_items
set fact_set_normalizer_version = 1
where fact_set_fingerprint is not null and fact_set_normalizer_version is null;

comment on column public.source_items.fact_set_normalizer_version is
  'Normalizer version that produced fact_set_fingerprint. Digests compare only within a version.';

create function public.persist_encrypted_source_item_v5(
  p_id uuid,
  p_user_id uuid,
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
  p_key_version integer,
  p_fact_set_normalizer_version integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
  conflicting_user_id uuid;
  stored_application_id text;
  stored_content_fingerprint text;
  stored_fact_set_fingerprint text;
  stored_fact_set_normalizer_version integer;
  stored_external_id text;
  stored_source public.source_kind;
  stored_source_account_id text;
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
    or p_fact_set_fingerprint is null
    or p_fact_set_fingerprint !~ '^[0-9a-f]{64}$'
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
    or p_key_version <= 0
    or p_fact_set_normalizer_version is null
    or p_fact_set_normalizer_version <= 0 then
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
    fact_set_fingerprint,
    fact_set_normalizer_version,
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
    p_fact_set_fingerprint,
    p_fact_set_normalizer_version,
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
    return 'stored';
  end if;

  select
    user_id,
    source,
    source_account_id,
    external_id,
    application_id,
    content_fingerprint,
    fact_set_fingerprint,
    fact_set_normalizer_version
  into
    conflicting_user_id,
    stored_source,
    stored_source_account_id,
    stored_external_id,
    stored_application_id,
    stored_content_fingerprint,
    stored_fact_set_fingerprint,
    stored_fact_set_normalizer_version
  from public.source_items
  where id = p_id;
  if found then
    if conflicting_user_id <> p_user_id then
      return 'tenant-conflict';
    end if;
    if stored_source <> p_source
      or stored_source_account_id is distinct from p_source_account_id
      or stored_external_id <> p_external_id
      or stored_application_id is distinct from p_application_id
      or stored_content_fingerprint <> p_content_fingerprint
      or stored_fact_set_fingerprint is null then
      return 'fact-integrity-conflict';
    end if;
    -- A fact-set fingerprint is only comparable against one produced by the same normalizer.
    -- Differing output under one version is still corruption; differing output across a version
    -- bump is the expected result of a deploy, and the already-stored row simply stands.
    if stored_fact_set_fingerprint <> p_fact_set_fingerprint
      and coalesce(stored_fact_set_normalizer_version, 1) = p_fact_set_normalizer_version then
      return 'fact-integrity-conflict';
    end if;
    return 'duplicate';
  end if;

  if exists (
    select 1
    from public.source_items
    where user_id = p_user_id
      and (
        (
          source = p_source
          and source_account_id is not distinct from p_source_account_id
          and external_id = p_external_id
        )
        or content_fingerprint = p_content_fingerprint
      )
  ) then
    return 'duplicate';
  end if;

  return 'tenant-conflict';
end;
$$;

create function public.persist_encrypted_source_item_v6(
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
  p_key_version integer,
  p_fact_set_normalizer_version integer
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

  result = public.persist_encrypted_source_item_v5(
    p_id, p_user_id, p_source, p_source_account_id, p_external_id, p_application_id,
    p_occurred_at, p_captured_at, p_content_fingerprint, p_fact_set_fingerprint,
    p_accepted_at, p_raw_expires_at, p_encryption_environment, p_raw_ciphertext,
    p_raw_nonce, p_wrapped_data_key, p_wrap_nonce, p_key_version,
    p_fact_set_normalizer_version
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

revoke all on function public.persist_encrypted_source_item_v5(
  uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer, integer
) from public, anon, authenticated;

revoke all on function public.persist_encrypted_source_item_v6(
  uuid, uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer, integer
) from public, anon, authenticated;
grant execute on function public.persist_encrypted_source_item_v5(
  uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer, integer
) to service_role;

grant execute on function public.persist_encrypted_source_item_v6(
  uuid, uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer, integer
) to service_role;
