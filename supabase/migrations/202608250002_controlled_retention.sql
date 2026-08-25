drop function public.purge_expired_raw_payloads();

create function public.purge_expired_raw_payloads(p_now timestamptz default now())
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
  where raw_expires_at <= p_now and raw_ciphertext is not null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.purge_expired_raw_payloads(timestamptz)
from public, anon, authenticated;
grant execute on function public.purge_expired_raw_payloads(timestamptz) to service_role;
