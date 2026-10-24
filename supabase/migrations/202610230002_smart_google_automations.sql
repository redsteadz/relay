-- Smart Automations extends the existing action ledger. No second approval ledger.
create table public.smart_automation_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  paused boolean not null default true
);
create table public.smart_google_services (
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null check (service in ('gmail','google-tasks','google-sheets','google-calendar')),
  connection_id uuid,
  enabled boolean not null default false,
  permission_required boolean not null default false,
  setup_started boolean not null default false,
  target_id text not null default '' check (length(target_id) <= 512),
  target_label text not null default '' check (length(target_label) <= 160),
  primary key(user_id,service),
  foreign key(user_id,connection_id) references public.connections(user_id,id) on delete set null (connection_id)
);
create table public.smart_automation_rules (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  revision integer not null check (revision > 0),
  unique(user_id,id),
  foreign key(user_id,id) references public.action_rules(user_id,id) on delete cascade
);
create table public.smart_action_effects (
  user_id uuid not null references auth.users(id) on delete cascade,
  effect_key text not null check (effect_key ~ '^[a-f0-9]{64}$'),
  action_run_id uuid not null,
  rule_revision integer not null,
  sheet_row bigint generated always as identity (start with 2),
  primary key(user_id,effect_key),
  unique(user_id,action_run_id),
  foreign key(user_id,action_run_id) references public.action_runs(user_id,id) on delete cascade
);
create table public.smart_action_outbox (
  action_run_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  outcome_unknown boolean not null default false,
  foreign key(user_id,action_run_id) references public.action_runs(user_id,id) on delete cascade
);
create table public.smart_google_oauth_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,
  sealed jsonb not null,
  expires_at timestamptz not null,
  launched boolean not null default false
);

alter table public.smart_automation_settings enable row level security;
alter table public.smart_google_services enable row level security;
alter table public.smart_automation_rules enable row level security;
alter table public.smart_action_effects enable row level security;
alter table public.smart_action_outbox enable row level security;
alter table public.smart_google_oauth_sessions enable row level security;
create policy "read own smart settings" on public.smart_automation_settings for select to authenticated using(user_id = (select auth.uid()));
create policy "read own Google services" on public.smart_google_services for select to authenticated using(user_id = (select auth.uid()));
create policy "read own smart rules" on public.smart_automation_rules for select to authenticated using(user_id = (select auth.uid()));
create policy "read own smart effects" on public.smart_action_effects for select to authenticated using(user_id = (select auth.uid()));
revoke all on public.smart_automation_settings, public.smart_google_services, public.smart_automation_rules, public.smart_action_effects, public.smart_action_outbox, public.smart_google_oauth_sessions from anon, authenticated;
grant select on public.smart_automation_settings, public.smart_google_services, public.smart_automation_rules, public.smart_action_effects to authenticated;
grant all on public.smart_automation_settings, public.smart_google_services, public.smart_automation_rules, public.smart_action_effects, public.smart_action_outbox, public.smart_google_oauth_sessions to service_role;

create function public.configure_smart_automation_v1(p_user_id uuid, p_configuration jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  rule_id uuid := (p_configuration->>'id')::uuid;
  old_revision integer;
  service_row public.smart_google_services;
  filter_id uuid := (p_configuration->>'filterRuleId')::uuid;
begin
  if p_user_id is null or public.filter_plan_has_forbidden_keys(p_configuration) then
    raise exception 'Invalid automation configuration' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || rule_id::text,0));
  select revision into old_revision from public.smart_automation_rules where user_id=p_user_id and id=rule_id for update;
  if (old_revision is not null and old_revision <> (p_configuration->>'revision')::integer)
    or (old_revision is null and (p_configuration->>'revision')::integer <> 1) then
    raise exception 'Configuration changed' using errcode='40001';
  end if;
  if not exists(select 1 from public.filter_rules where user_id=p_user_id and id=filter_id) then
    raise exception 'Filter unavailable' using errcode='P0002';
  end if;
  select * into service_row from public.smart_google_services where user_id=p_user_id and service=p_configuration->>'service' for share;
  if service_row.connection_id is null or service_row.target_id <> p_configuration->>'targetId' then
    raise exception 'Destination unavailable' using errcode='P0002';
  end if;
  insert into public.action_rules(id,user_id,filter_rule_id,connection_id,provider,operation,input_template,approval_mode,enabled)
  values(rule_id,p_user_id,filter_id,service_row.connection_id,(p_configuration->>'service')::public.action_provider,
    case p_configuration->>'service' when 'google-tasks' then 'create-task' when 'google-sheets' then 'record-transaction' when 'google-calendar' then 'create-event' else null end,
    '{}',p_configuration->>'approval',(p_configuration->>'enabled')::boolean)
  on conflict(id) do update set filter_rule_id=excluded.filter_rule_id,connection_id=excluded.connection_id,
    approval_mode=excluded.approval_mode,enabled=excluded.enabled
  where public.action_rules.user_id=p_user_id and public.action_rules.provider=excluded.provider;
  if not found then raise exception 'Automation unavailable' using errcode='P0002'; end if;
  insert into public.smart_automation_rules(id,user_id,configuration,revision)
  values(rule_id,p_user_id,jsonb_set(p_configuration,'{revision}',to_jsonb(coalesce(old_revision,0)+1)),coalesce(old_revision,0)+1)
  on conflict(id) do update set configuration=excluded.configuration,revision=excluded.revision where public.smart_automation_rules.user_id=p_user_id;
  -- An edit never reinterprets an existing approval. Previously running effects are reconciled.
  update public.action_runs set status='cancelled',completed_at=now() where user_id=p_user_id and action_rule_id=rule_id and status in ('awaiting-approval','approved','proposed');
  insert into public.audit_log(user_id,actor_type,action,target_type,target_id,metadata)
  values(p_user_id,'user','smart.rule_configured','action_rule',rule_id::text,jsonb_build_object('version',coalesce(old_revision,0)+1));
  return true;
end $$;
revoke all on function public.configure_smart_automation_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.configure_smart_automation_v1(uuid,jsonb) to service_role;

create function public.enqueue_smart_action_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='approved' and exists(select 1 from public.smart_automation_rules where user_id=new.user_id and id=new.action_rule_id) then
    insert into public.smart_action_outbox(action_run_id,user_id) values(new.id,new.user_id) on conflict(action_run_id) do nothing;
  end if;
  return new;
end $$;
create trigger smart_action_approved after insert or update of status on public.action_runs for each row execute function public.enqueue_smart_action_v1();

create function public.propose_smart_action_v1(p_user_id uuid,p_rule_id uuid,p_event_id uuid,p_effect_key text,p_input jsonb,p_revision integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare run public.action_runs; existing_id uuid; config public.smart_automation_rules; row_number bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_effect_key,0));
  select action_run_id into existing_id from public.smart_action_effects where user_id=p_user_id and effect_key=p_effect_key;
  if existing_id is not null then return existing_id; end if;
  select * into config from public.smart_automation_rules where user_id=p_user_id and id=p_rule_id and revision=p_revision for share;
  if config.id is null or coalesce((select paused from public.smart_automation_settings where user_id=p_user_id),true) then
    raise exception 'Automation paused or changed' using errcode='P0002';
  end if;
  run := public.propose_action_run_v1(p_user_id,p_rule_id,p_event_id,p_input);
  insert into public.smart_action_effects(user_id,effect_key,action_run_id,rule_revision) values(p_user_id,p_effect_key,run.id,p_revision) returning sheet_row into row_number;
  if run.provider='google-sheets' then
    update public.action_runs set input=jsonb_set(jsonb_set(input,'{range}',to_jsonb('''Relay Expenses''!A'||row_number::text||':G'||row_number::text)),'{values,0}',to_jsonb(run.id::text)) where id=run.id and user_id=p_user_id;
  end if;
  return run.id;
end $$;
revoke all on function public.propose_smart_action_v1(uuid,uuid,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.propose_smart_action_v1(uuid,uuid,uuid,text,jsonb,integer) to service_role;

-- Claim only runnable work, with a durable lease. An expired lease means reconcile, not fresh insert.
create function public.claim_smart_outbox_v1(p_user_id uuid,p_run_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.smart_action_outbox set lease_until=now()+interval '2 minutes',attempts=attempts+1
  where user_id=p_user_id and action_run_id=p_run_id and not outcome_unknown
    and attempts < 5 and available_at<=now() and (lease_until is null or lease_until<now());
  return found;
end $$;
revoke all on function public.claim_smart_outbox_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_smart_outbox_v1(uuid,uuid) to service_role;

create function public.check_smart_dispatch_v1(p_user_id uuid,p_run_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare run public.action_runs; rule public.action_rules; configuration public.smart_automation_rules; service public.smart_google_services; effect public.smart_action_effects;
begin
  select * into run from public.action_runs where user_id=p_user_id and id=p_run_id for update;
  select * into rule from public.action_rules where user_id=p_user_id and id=run.action_rule_id for share;
  select * into configuration from public.smart_automation_rules where user_id=p_user_id and id=rule.id for share;
  select * into service from public.smart_google_services where user_id=p_user_id and service=rule.provider::text for share;
  select * into effect from public.smart_action_effects where user_id=p_user_id and action_run_id=p_run_id;
  if run.id is null or run.status not in ('approved','running') or not rule.enabled or configuration.id is null
    or effect.rule_revision is distinct from configuration.revision or service.connection_id is null
    or not service.enabled or service.permission_required or rule.connection_id is distinct from service.connection_id
    or coalesce((select paused from public.smart_automation_settings where user_id=p_user_id),true)
    or configuration.configuration->>'targetId' is distinct from service.target_id
    or configuration.configuration->>'service' is distinct from rule.provider::text
    or configuration.configuration->>'approval' is distinct from rule.approval_mode
    or configuration.configuration->>'filterRuleId' is distinct from rule.filter_rule_id::text
    or configuration.configuration->>'enabled' is distinct from 'true'
    or (select count(*) from public.action_runs where user_id=p_user_id and created_at>=date_trunc('day',now()) and attempt_count>0)>100
    or not exists(select 1 from public.classifications c join public.relay_events e on e.source_item_id=c.source_item_id and e.user_id=c.user_id where e.id=run.event_id and e.user_id=p_user_id and c.origin='server' and c.filter_rule_id=rule.filter_rule_id and c.superseded_at is null)
  then raise exception 'Dispatch is not authorized' using errcode='P0002'; end if;
  return true;
end $$;
revoke all on function public.check_smart_dispatch_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.check_smart_dispatch_v1(uuid,uuid) to service_role;

create function public.disconnect_smart_service_v1(p_user_id uuid,p_service text)
returns boolean language plpgsql security definer set search_path='' as $$
declare connection uuid;
begin
  select connection_id into connection from public.smart_google_services where user_id=p_user_id and service=p_service for update;
  update public.smart_google_services set enabled=false,connection_id=null where user_id=p_user_id and service=p_service;
  update public.action_rules set enabled=false,connection_id=null where user_id=p_user_id and connection_id=connection;
  update public.action_runs set status='cancelled',completed_at=now() where user_id=p_user_id and action_rule_id in(select id from public.action_rules where user_id=p_user_id and provider::text=p_service) and status in ('proposed','awaiting-approval','approved');
  -- Gmail teardown has its own durable protocol. Keep its credential until that protocol completes.
  if p_service<>'gmail' then delete from public.connections where user_id=p_user_id and id=connection; end if;
  insert into public.audit_log(user_id,actor_type,action,target_type,metadata) values(p_user_id,'user','smart.service_disconnected','connection',jsonb_build_object('provider',p_service));
  return true;
end $$;
revoke all on function public.disconnect_smart_service_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.disconnect_smart_service_v1(uuid,text) to service_role;

create function public.retry_smart_action_v1(p_run_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare tenant uuid := (select auth.uid());
begin
  if tenant is null then raise exception 'Sign in required' using errcode='42501'; end if;
  update public.action_runs r set status='approved',error_code=null where user_id=tenant and id=p_run_id and status='failed' and error_code in ('permission-required','rate-limit') and attempt_count<5
    and exists(select 1 from public.smart_action_effects e join public.smart_automation_rules c on c.user_id=e.user_id and c.id=r.action_rule_id where e.user_id=tenant and e.action_run_id=p_run_id and e.rule_revision=c.revision);
  if not found then raise exception 'Retry unavailable' using errcode='P0002'; end if;
  update public.smart_action_outbox set lease_until=null,available_at=now() where user_id=tenant and action_run_id=p_run_id and not outcome_unknown;
  insert into public.audit_log(user_id,actor_type,action,target_type,target_id) values(tenant,'user','smart.retry_requested','action_run',p_run_id::text);
  return true;
end $$;
revoke all on function public.retry_smart_action_v1(uuid) from public,anon;
grant execute on function public.retry_smart_action_v1(uuid) to authenticated;
