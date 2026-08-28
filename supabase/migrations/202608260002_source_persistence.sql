create function public.persist_encrypted_source_item(
  p_id uuid,
  p_user_id uuid,
  p_source public.source_kind,
  p_source_account_id text,
  p_external_id text,
  p_application_id text,
  p_occurred_at timestamptz,
  p_captured_at timestamptz,
  p_content_fingerprint text,
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

revoke all on function public.persist_encrypted_source_item(
  uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  bytea, bytea, bytea, bytea, integer
) from public, anon, authenticated;
grant execute on function public.persist_encrypted_source_item(
  uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  bytea, bytea, bytea, bytea, integer
) to service_role;
