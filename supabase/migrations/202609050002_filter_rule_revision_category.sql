-- A rule records the category it files a matching capture into.
--
-- `filter_rules.category_id` exists but nothing could set it: revisions are created only through
-- this routine, and it had no parameter for one. A rule could therefore be pointed at a category in
-- the schema and never in practice, which is how a matching rule ended up classifying a capture
-- into nothing at all.
--
-- The category is checked against the same tenant before it is stored, so a rule cannot be pointed
-- at another person's category by guessing an id. Null remains valid and means the rule classifies
-- without naming a category.
--
-- Defaulted last so existing callers keep working unchanged during a rolling deploy.
--
-- The previous signature is dropped rather than replaced. Adding a parameter produces a new
-- overload rather than a replacement, and Postgres then cannot choose between them for a call that
-- omits the defaulted arguments -- every existing caller becomes ambiguous. Dropping first leaves
-- exactly one function, which the defaults make callable in every shape the old one accepted.

drop function if exists public.create_filter_rule_revision(
  uuid, text, text, jsonb, jsonb, jsonb, boolean, uuid, integer
);

create function public.create_filter_rule_revision(
  p_user_id uuid,
  p_name text,
  p_intent text,
  p_plan jsonb,
  p_supported_predicates jsonb,
  p_unsupported_clauses jsonb,
  p_enabled boolean default true,
  p_series_id uuid default null,
  p_expected_version integer default null,
  p_category_id uuid default null
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

  if p_category_id is not null and not exists (
    select 1 from public.categories where user_id = p_user_id and id = p_category_id
  ) then
    raise exception 'Filter category must belong to this tenant' using errcode = '22023';
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
    enabled,
    category_id
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
    target_enabled,
    p_category_id
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
  uuid, text, text, jsonb, jsonb, jsonb, boolean, uuid, integer, uuid
) from public, anon, authenticated;
grant execute on function public.create_filter_rule_revision(
  uuid, text, text, jsonb, jsonb, jsonb, boolean, uuid, integer, uuid
) to service_role;
