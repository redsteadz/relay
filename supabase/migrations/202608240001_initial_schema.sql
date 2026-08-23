create extension if not exists pgcrypto with schema extensions;

create type public.source_kind as enum ('gmail', 'notification', 'sms', 'email');
create type public.event_kind as enum ('task', 'reminder', 'calendar-event', 'fact');
create type public.action_provider as enum ('google-tasks', 'nextcloud-budget', 'webhook');
create type public.action_status as enum (
  'proposed', 'awaiting-approval', 'approved', 'running', 'succeeded', 'failed', 'cancelled'
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text not null check (platform in ('android', 'ios', 'web')),
  public_key text,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id)
);

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  external_account_id text,
  credential_ciphertext bytea not null,
  credential_nonce bytea not null,
  wrapped_data_key bytea not null,
  wrap_nonce bytea not null,
  key_version integer not null default 1 check (key_version > 0),
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique nulls not distinct (user_id, provider, external_account_id)
);

create table public.source_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid,
  source public.source_kind not null,
  source_account_id text,
  external_id text not null,
  application_id text,
  occurred_at timestamptz not null,
  captured_at timestamptz not null,
  sender text,
  subject text,
  attributes jsonb not null default '{}'::jsonb,
  content_fingerprint text not null,
  raw_ciphertext bytea,
  raw_nonce bytea,
  wrapped_data_key bytea,
  wrap_nonce bytea,
  key_version integer check (key_version > 0),
  raw_expires_at timestamptz not null default (now() + interval '7 days'),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique nulls not distinct (user_id, source, source_account_id, external_id),
  unique (user_id, content_fingerprint),
  foreign key (user_id, connection_id) references public.connections(user_id, id)
    on delete set null (connection_id),
  check (
    (raw_ciphertext is null and raw_nonce is null and wrapped_data_key is null and wrap_nonce is null and key_version is null)
    or
    (raw_ciphertext is not null and raw_nonce is not null and wrapped_data_key is not null and wrap_nonce is not null and key_version is not null)
  )
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  quiet_by_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, slug)
);

create table public.classifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid not null,
  category_id uuid,
  method text not null check (method in ('deterministic', 'semantic', 'manual')),
  confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  rationale text,
  model text,
  created_at timestamptz not null default now(),
  foreign key (user_id, source_item_id) references public.source_items(user_id, id) on delete cascade,
  foreign key (user_id, category_id) references public.categories(user_id, id)
    on delete set null (category_id)
);

create table public.filter_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  intent text not null,
  plan jsonb not null,
  version integer not null default 1 check (version > 0),
  enabled boolean not null default true,
  approval_mode text not null default 'required' check (approval_mode in ('required', 'automatic')),
  dismiss_source_notification boolean not null default false,
  dismissal_dry_run_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, name, version),
  check (
    not dismiss_source_notification
    or (
      approval_mode = 'automatic'
      and dismissal_dry_run_completed_at is not null
      and plan ? 'deterministic'
      and not (plan ? 'semantic')
    )
  )
);

create table public.relay_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid not null,
  kind public.event_kind not null,
  title text not null,
  summary text not null,
  starts_at timestamptz,
  due_at timestamptz,
  confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  provenance jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, source_item_id) references public.source_items(user_id, id) on delete cascade
);

create table public.action_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filter_rule_id uuid not null,
  connection_id uuid,
  provider public.action_provider not null,
  operation text not null,
  input_template jsonb not null,
  approval_mode text not null default 'required' check (approval_mode in ('required', 'automatic')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, filter_rule_id) references public.filter_rules(user_id, id) on delete cascade,
  foreign key (user_id, connection_id) references public.connections(user_id, id) on delete restrict
);

create table public.action_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_rule_id uuid not null,
  event_id uuid not null,
  provider public.action_provider not null,
  status public.action_status not null default 'proposed',
  input jsonb not null,
  provider_reference text,
  workflow_instance_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  error_code text,
  error_message text,
  approved_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, action_rule_id, event_id),
  foreign key (user_id, action_rule_id) references public.action_rules(user_id, id) on delete restrict,
  foreign key (user_id, event_id) references public.relay_events(user_id, id) on delete cascade
);

create table public.ai_disclosures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid not null,
  filter_rule_id uuid,
  provider text not null default 'openai',
  model text not null,
  disclosed_fields text[] not null,
  redactions jsonb not null default '[]'::jsonb,
  purpose text not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, source_item_id) references public.source_items(user_id, id) on delete cascade,
  foreign key (user_id, filter_rule_id) references public.filter_rules(user_id, id)
    on delete set null (filter_rule_id)
);

create table public.audit_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'device', 'system', 'connector')),
  actor_id text,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index source_items_user_created_idx on public.source_items (user_id, created_at desc);
create index source_items_expiry_idx on public.source_items (raw_expires_at) where raw_ciphertext is not null;
create index relay_events_user_created_idx on public.relay_events (user_id, created_at desc);
create index action_runs_user_status_idx on public.action_runs (user_id, status, created_at desc);
create index audit_log_user_created_idx on public.audit_log (user_id, created_at desc);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger connections_set_updated_at before update on public.connections
for each row execute function public.set_updated_at();
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();
create trigger filter_rules_set_updated_at before update on public.filter_rules
for each row execute function public.set_updated_at();
create trigger action_rules_set_updated_at before update on public.action_rules
for each row execute function public.set_updated_at();
create trigger action_runs_set_updated_at before update on public.action_runs
for each row execute function public.set_updated_at();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));

  insert into public.categories (user_id, slug, name, is_system, quiet_by_default)
  values
    (new.id, 'transaction', 'Transactions', true, false),
    (new.id, 'task', 'Tasks', true, false),
    (new.id, 'event', 'Events', true, false),
    (new.id, 'reminder', 'Reminders', true, false),
    (new.id, 'delivery', 'Deliveries', true, false),
    (new.id, 'travel', 'Travel', true, false),
    (new.id, 'security', 'Security', true, false),
    (new.id, 'communication', 'Communication', true, false),
    (new.id, 'promotion', 'Promotions', true, true),
    (new.id, 'other', 'Other', true, false);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create function public.purge_expired_raw_payloads()
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
      key_version = null
  where raw_expires_at <= now() and raw_ciphertext is not null;
  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.purge_expired_raw_payloads() from public, anon, authenticated;
grant execute on function public.purge_expired_raw_payloads() to service_role;

create function public.decide_action_run(p_action_run_id uuid, p_decision text)
returns public.action_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  decided public.action_runs;
  next_status public.action_status;
begin
  if p_decision = 'approve' then
    next_status = 'approved';
  elsif p_decision = 'cancel' then
    next_status = 'cancelled';
  else
    raise exception 'Decision must be approve or cancel' using errcode = '22023';
  end if;

  update public.action_runs
  set status = next_status,
      approved_at = case when next_status = 'approved' then now() else approved_at end
  where id = p_action_run_id
    and user_id = (select auth.uid())
    and status = 'awaiting-approval'
  returning * into decided;

  if not found then
    raise exception 'Action run is unavailable or no longer awaiting approval' using errcode = 'P0002';
  end if;

  insert into public.audit_log (user_id, actor_type, actor_id, action, target_type, target_id)
  values (
    decided.user_id,
    'user',
    decided.user_id::text,
    case when next_status = 'approved' then 'action.approved' else 'action.cancelled' end,
    'action_run',
    decided.id::text
  );

  return decided;
end;
$$;

revoke all on function public.decide_action_run(uuid, text) from public, anon;
grant execute on function public.decide_action_run(uuid, text) to authenticated;

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.connections enable row level security;
alter table public.source_items enable row level security;
alter table public.categories enable row level security;
alter table public.classifications enable row level security;
alter table public.filter_rules enable row level security;
alter table public.relay_events enable row level security;
alter table public.action_rules enable row level security;
alter table public.action_runs enable row level security;
alter table public.ai_disclosures enable row level security;
alter table public.audit_log enable row level security;

create policy "users manage own profile" on public.profiles
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users manage own devices" on public.devices
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users view own connections" on public.connections
for select using ((select auth.uid()) = user_id);
create policy "users delete own connections" on public.connections
for delete using ((select auth.uid()) = user_id);
create policy "users view own source items" on public.source_items
for select using ((select auth.uid()) = user_id);
create policy "users manage own categories" on public.categories
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users view own classifications" on public.classifications
for select using ((select auth.uid()) = user_id);
create policy "users manage own filters" on public.filter_rules
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users view own events" on public.relay_events
for select using ((select auth.uid()) = user_id);
create policy "users manage own action rules" on public.action_rules
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users view own action runs" on public.action_runs
for select using ((select auth.uid()) = user_id);
create policy "users view own disclosures" on public.ai_disclosures
for select using ((select auth.uid()) = user_id);
create policy "users view own audit log" on public.audit_log
for select using ((select auth.uid()) = user_id);

grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
