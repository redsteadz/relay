-- Versioned filter-plan persistence after Gmail History (issue #26).
--
-- Natural-language compilation happens in Pipeline. This migration makes each result append-only,
-- keeps compiler disclosures beside the plan, and exposes tenant rows as read-only history.

create function public.filter_plan_has_forbidden_keys(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  item record;
begin
  if jsonb_typeof(p_value) = 'object' then
    for item in select object_item.key, object_item.value from jsonb_each(p_value) as object_item
    loop
      if item.key = any (array['action', 'provider', 'operation', 'endpoint', 'credential', 'credentials'])
        or public.filter_plan_has_forbidden_keys(item.value)
      then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for item in select array_value as value from jsonb_array_elements(p_value) as array_value
    loop
      if public.filter_plan_has_forbidden_keys(item.value) then
        return true;
      end if;
    end loop;
  end if;
  return false;
end;
$$;

revoke all on function public.filter_plan_has_forbidden_keys(jsonb)
from public, anon, authenticated;
grant execute on function public.filter_plan_has_forbidden_keys(jsonb) to service_role;

alter table public.filter_rules
  add column series_id uuid default gen_random_uuid(),
  add column compiler_version integer not null default 1,
  add column supported_predicates jsonb not null default '[]'::jsonb,
  add column unsupported_clauses jsonb not null default '[]'::jsonb;

-- Existing rows predate compiler metadata. Preserve their ids as stable series ids and normalize
-- their plans to the v1 wire shape before adding constraints.
update public.filter_rules
set series_id = id,
    plan = plan || jsonb_build_object(
      'schemaVersion', 1,
      'compilerVersion', 1,
      'intent', intent
    );

alter table public.filter_rules
  alter column series_id set not null,
  drop constraint filter_rules_user_id_name_version_key,
  add constraint filter_rules_user_series_version_key unique (user_id, series_id, version),
  add constraint filter_rules_compiler_version_positive check (compiler_version > 0),
  add constraint filter_rules_plan_object check (jsonb_typeof(plan) = 'object'),
  add constraint filter_rules_plan_revision_matches check (
    plan ->> 'schemaVersion' = '1'
    and plan ->> 'compilerVersion' = compiler_version::text
    and plan ->> 'intent' = intent
  ),
  add constraint filter_rules_supported_predicates_array check (
    jsonb_typeof(supported_predicates) = 'array'
  ),
  add constraint filter_rules_unsupported_clauses_array check (
    jsonb_typeof(unsupported_clauses) = 'array'
  ),
  add constraint filter_rules_plan_cannot_select_actions check (
    not public.filter_plan_has_forbidden_keys(plan)
  );

create index filter_rules_user_series_latest_idx
  on public.filter_rules (user_id, series_id, version desc);

drop policy "users manage own filters" on public.filter_rules;
create policy "users view own filter revisions" on public.filter_rules
for select using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.filter_rules from authenticated, service_role;

-- OpenAI deletion must atomically disable semantic rules. Preserve Gmail's requirement that active
-- watches disconnect through provider cleanup before their connection row can disappear.
drop policy "users delete own non-active-gmail connections" on public.connections;
create policy "users delete own unmanaged connections" on public.connections
for delete using (
  (select auth.uid()) = user_id
  and provider <> 'openai'
  and (provider <> 'gmail' or status <> 'active')
);

create function public.enforce_filter_revision_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Whole-account deletion reaches this trigger through a nested auth.users foreign-key cascade.
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    raise exception 'Filter revisions are immutable; create a new revision'
      using errcode = '55000';
  end if;

  -- Credential revocation may monotonically disable a semantic revision as a safety response. No
  -- user-editable plan or identity field may change through this exception.
  if current_role in ('service_role', 'postgres')
    and current_setting('relay.allow_filter_safety_disable', true) = 'true'
    and old.enabled
    and not new.enabled
    and (to_jsonb(new) - array['enabled', 'updated_at'])
      = (to_jsonb(old) - array['enabled', 'updated_at'])
  then
    return new;
  end if;
  raise exception 'Filter revisions are immutable; create a new revision'
    using errcode = '55000';
end;
$$;

revoke all on function public.enforce_filter_revision_immutability()
from public, anon, authenticated;

create trigger filter_rules_enforce_immutability
before update or delete on public.filter_rules
for each row execute function public.enforce_filter_revision_immutability();

create function public.create_filter_rule_revision(
  p_user_id uuid,
  p_name text,
  p_intent text,
  p_plan jsonb,
  p_supported_predicates jsonb,
  p_unsupported_clauses jsonb,
  p_enabled boolean default true,
  p_series_id uuid default null,
  p_expected_version integer default null
)
returns public.filter_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_version integer;
  next_version integer;
  revision public.filter_rules;
  target_series_id uuid := coalesce(p_series_id, gen_random_uuid());
  target_compiler_version integer;
  target_enabled boolean;
begin
  if p_user_id is null then
    raise exception 'Filter tenant is required' using errcode = '22023';
  end if;
  if p_name is null or btrim(p_name) = '' or char_length(p_name) > 80 then
    raise exception 'Filter name must contain 1 to 80 characters' using errcode = '22023';
  end if;
  if p_intent is null or btrim(p_intent) = '' or char_length(p_intent) > 4000 then
    raise exception 'Filter intent must contain 1 to 4000 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan ->> 'schemaVersion' is distinct from '1'
    or p_plan ->> 'intent' is distinct from p_intent
  then
    raise exception 'Filter plan does not match its v1 intent' using errcode = '22023';
  end if;
  begin
    target_compiler_version := (p_plan ->> 'compilerVersion')::integer;
  exception when invalid_text_representation then
    raise exception 'Filter compiler version must be a positive integer' using errcode = '22023';
  end;
  if target_compiler_version is null or target_compiler_version <= 0 then
    raise exception 'Filter compiler version must be a positive integer' using errcode = '22023';
  end if;
  if jsonb_typeof(p_supported_predicates) is distinct from 'array'
    or jsonb_typeof(p_unsupported_clauses) is distinct from 'array'
  then
    raise exception 'Filter compiler disclosures must be arrays' using errcode = '22023';
  end if;
  if public.filter_plan_has_forbidden_keys(p_plan) then
    raise exception 'Filter plans cannot select actions, providers, operations, endpoints, or credentials'
      using errcode = '22023';
  end if;

  -- Serializes credential revocation against every filter append for this tenant. If revocation
  -- commits first, a waiting semantic append observes no active key and persists disabled. If an
  -- append commits first, revocation observes and disables it before deleting the key.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 26));
  target_enabled := p_enabled and (
    not (p_plan ? 'semantic')
    or exists (
      select 1
      from public.connections
      where user_id = p_user_id and provider = 'openai' and status = 'active'
    )
  );

  if p_series_id is null then
    if p_expected_version is not null then
      raise exception 'New filter series cannot have an expected version' using errcode = '22023';
    end if;
    next_version := 1;
  else
    if p_expected_version is null or p_expected_version <= 0 then
      raise exception 'Existing filter series requires a positive expected version'
        using errcode = '22023';
    end if;

    -- Serialize allocations per series. Advisory lock runs as a separate statement, so the latest
    -- revision query receives a fresh READ COMMITTED snapshot after any waiting writer commits.
    perform pg_advisory_xact_lock(hashtextextended(target_series_id::text, 0));
    select max(version)
    into current_version
    from public.filter_rules
    where user_id = p_user_id and series_id = target_series_id;

    if current_version is null then
      raise exception 'Filter series is unavailable' using errcode = 'P0002';
    end if;
    if current_version <> p_expected_version then
      raise exception 'Filter revision is stale: expected %, current %',
        p_expected_version, current_version
        using errcode = '23505';
    end if;
    next_version := current_version + 1;
  end if;

  insert into public.filter_rules (
    user_id,
    series_id,
    name,
    intent,
    plan,
    compiler_version,
    supported_predicates,
    unsupported_clauses,
    version,
    enabled
  ) values (
    p_user_id,
    target_series_id,
    btrim(p_name),
    p_intent,
    p_plan,
    target_compiler_version,
    p_supported_predicates,
    p_unsupported_clauses,
    next_version,
    target_enabled
  ) returning * into revision;

  insert into public.audit_log (
    user_id, actor_type, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    'system',
    'filter.revision_compiled',
    'filter_rule',
    revision.id::text,
    jsonb_build_object(
      'seriesId', revision.series_id,
      'version', revision.version,
      'compilerVersion', revision.compiler_version,
      'unsupportedClauseCount', jsonb_array_length(revision.unsupported_clauses)
    )
  );

  return revision;
end;
$$;

revoke all on function public.create_filter_rule_revision(
  uuid, text, text, jsonb, jsonb, jsonb, boolean, uuid, integer
) from public, anon, authenticated;
grant execute on function public.create_filter_rule_revision(
  uuid, text, text, jsonb, jsonb, jsonb, boolean, uuid, integer
) to service_role;

create function public.revoke_openai_connection(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_connection_id uuid;
  disabled_rule_count bigint;
begin
  if p_user_id is null then
    raise exception 'OpenAI credential tenant is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 26));
  select id
  into target_connection_id
  from public.connections
  where user_id = p_user_id and provider = 'openai'
  order by created_at, id
  limit 1
  for update;

  if target_connection_id is null then
    return jsonb_build_object('revoked', false, 'disabledRuleCount', 0);
  end if;

  perform set_config('relay.allow_filter_safety_disable', 'true', true);
  update public.filter_rules
  set enabled = false
  where user_id = p_user_id
    and enabled
    and plan ? 'semantic';
  get diagnostics disabled_rule_count = row_count;

  delete from public.connections
  where user_id = p_user_id and id = target_connection_id;

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    'user',
    p_user_id::text,
    'connector.revoked',
    'connection',
    target_connection_id::text,
    jsonb_build_object('provider', 'openai', 'disabledRuleCount', disabled_rule_count)
  );

  return jsonb_build_object(
    'revoked', true,
    'connectionId', target_connection_id,
    'disabledRuleCount', disabled_rule_count
  );
end;
$$;

revoke all on function public.revoke_openai_connection(uuid)
from public, anon, authenticated;
grant execute on function public.revoke_openai_connection(uuid) to service_role;

comment on column public.filter_rules.series_id is
  'Stable filter identity shared by immutable compiled revisions.';
comment on column public.filter_rules.supported_predicates is
  'Compiler capability disclosure shown with this revision.';
comment on column public.filter_rules.unsupported_clauses is
  'Intent clauses not compiled deterministically, with user-visible reasons.';
