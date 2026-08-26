drop policy "users manage own devices" on public.devices;

create policy "users view own devices" on public.devices
for select using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.devices from authenticated;

alter table public.devices
add constraint devices_name_length check (char_length(name) between 1 and 80);

alter table public.devices drop constraint devices_pkey;
alter table public.devices add primary key (user_id, id);

create function public.register_device(p_device_id uuid, p_platform text)
returns public.devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  existing public.devices;
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_platform not in ('android', 'ios', 'web') then
    raise exception 'Device registration is invalid' using errcode = '22023';
  end if;

  insert into public.devices (id, user_id, name, platform)
  values (
    p_device_id,
    owner_id,
    initcap(p_platform) || ' ' || upper(substr(replace(p_device_id::text, '-', ''), 1, 6)),
    p_platform
  ) on conflict (user_id, id) do nothing;

  select * into existing from public.devices where user_id = owner_id and id = p_device_id;
  if existing.revoked_at is not null or existing.platform <> p_platform then
    raise exception 'Device is unavailable' using errcode = 'P0002';
  end if;
  return existing;
end;
$$;

create function public.revoke_device(p_device_id uuid)
returns public.devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  existing public.devices;
begin
  if owner_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  update public.devices
  set revoked_at = coalesce(revoked_at, now())
  where id = p_device_id and user_id = owner_id
  returning * into existing;
  if not found then
    raise exception 'Device is unavailable' using errcode = 'P0002';
  end if;
  return existing;
end;
$$;

create function public.authorize_device_ingress(p_device_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  authorized boolean;
begin
  if owner_id is null then return false; end if;
  update public.devices
  set last_seen_at = now()
  where id = p_device_id and user_id = owner_id and revoked_at is null
  returning true into authorized;
  return coalesce(authorized, false);
end;
$$;

revoke all on function public.register_device(uuid, text) from public, anon;
revoke all on function public.revoke_device(uuid) from public, anon;
revoke all on function public.authorize_device_ingress(uuid) from public, anon;
grant execute on function public.register_device(uuid, text) to authenticated;
grant execute on function public.revoke_device(uuid) to authenticated;
grant execute on function public.authorize_device_ingress(uuid) to authenticated;
