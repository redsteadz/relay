do $$
begin
  if exists (select 1 from public.connections) then
    raise exception 'Connections need explicit encryption environment ownership before migration';
  end if;
  if exists (select 1 from public.source_items where raw_ciphertext is not null) then
    raise exception 'Encrypted source items need explicit environment ownership before migration';
  end if;
end;
$$;

alter table public.connections
add column encryption_environment text not null
check (encryption_environment in ('development', 'production'));

alter table public.source_items
add column encryption_environment text
check (encryption_environment in ('development', 'production'));

alter table public.source_items drop constraint source_items_check;
alter table public.source_items add constraint source_items_encryption_complete check (
  (
    raw_ciphertext is null
    and raw_nonce is null
    and wrapped_data_key is null
    and wrap_nonce is null
    and key_version is null
    and encryption_environment is null
  )
  or
  (
    raw_ciphertext is not null
    and raw_nonce is not null
    and wrapped_data_key is not null
    and wrap_nonce is not null
    and key_version is not null
    and encryption_environment is not null
  )
);

create index connections_kek_inventory_idx
on public.connections (encryption_environment, key_version, id);

create index source_items_kek_inventory_idx
on public.source_items (encryption_environment, key_version, id)
where raw_ciphertext is not null;

create or replace function public.purge_expired_raw_payloads()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected bigint;
begin
  update public.source_items
  set raw_ciphertext = null,
      raw_nonce = null,
      wrapped_data_key = null,
      wrap_nonce = null,
      key_version = null,
      encryption_environment = null
  where raw_expires_at <= now() and raw_ciphertext is not null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

create function public.kek_encryption_inventory(p_environment text)
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
  order by 1, 2
$$;

create function public.cas_rewrap_connection_data_key(
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
    raise exception 'Invalid connection rewrap request' using errcode = '22023';
  end if;

  update public.connections
  set wrapped_data_key = p_new_wrapped_data_key,
      wrap_nonce = p_new_wrap_nonce,
      key_version = p_new_key_version
  where id = p_id
    and user_id = p_user_id
    and encryption_environment = p_environment
    and key_version = p_expected_key_version
    and wrapped_data_key = p_expected_wrapped_data_key
    and wrap_nonce = p_expected_wrap_nonce
    and credential_ciphertext = p_expected_ciphertext
    and credential_nonce = p_expected_payload_nonce;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

create function public.cas_rewrap_source_item_data_key(
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
    raise exception 'Invalid source item rewrap request' using errcode = '22023';
  end if;

  update public.source_items
  set wrapped_data_key = p_new_wrapped_data_key,
      wrap_nonce = p_new_wrap_nonce,
      key_version = p_new_key_version
  where id = p_id
    and user_id = p_user_id
    and encryption_environment = p_environment
    and key_version = p_expected_key_version
    and wrapped_data_key = p_expected_wrapped_data_key
    and wrap_nonce = p_expected_wrap_nonce
    and raw_ciphertext = p_expected_ciphertext
    and raw_nonce = p_expected_payload_nonce;
  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.kek_encryption_inventory(text) from public, anon, authenticated;
revoke all on function public.cas_rewrap_connection_data_key(
  text, uuid, uuid, integer, bytea, bytea, bytea, bytea, integer, bytea, bytea
) from public, anon, authenticated;
revoke all on function public.cas_rewrap_source_item_data_key(
  text, uuid, uuid, integer, bytea, bytea, bytea, bytea, integer, bytea, bytea
) from public, anon, authenticated;

grant execute on function public.kek_encryption_inventory(text) to service_role;
grant execute on function public.cas_rewrap_connection_data_key(
  text, uuid, uuid, integer, bytea, bytea, bytea, bytea, integer, bytea, bytea
) to service_role;
grant execute on function public.cas_rewrap_source_item_data_key(
  text, uuid, uuid, integer, bytea, bytea, bytea, bytea, integer, bytea, bytea
) to service_role;
