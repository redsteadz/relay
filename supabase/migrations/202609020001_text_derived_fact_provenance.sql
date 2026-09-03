-- Normalizer version 2 derives facts from an envelope's own subject and body, so a fact's
-- provenance may now name those fields. The accepted provenance shape is enforced in two places
-- that must agree: `factProvenanceFieldSchema` in @relay/contracts and the validation loop inside
-- this function. Only the accepted field list changes; every other check is carried over verbatim.
--
-- Provenance still records a field name and an optional character span, never a value read from
-- the source, so widening the field list discloses no message content to this table.

create or replace function public.persist_source_facts(
  p_user_id uuid,
  p_source_item_id uuid,
  p_fact_set_fingerprint text,
  p_normalizer_version integer,
  p_facts jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate jsonb;
  candidate_position bigint;
  evidence jsonb;
  fact_count integer;
  inserted_count integer;
  existing_count integer;
  stored_fact_set_fingerprint text;
begin
  if p_user_id is null
    or p_source_item_id is null
    or p_fact_set_fingerprint is null
    or p_fact_set_fingerprint !~ '^[0-9a-f]{64}$'
    or p_normalizer_version is null
    or p_normalizer_version <= 0
    or p_facts is null then
    raise exception 'Invalid source fact set' using errcode = '22023';
  end if;
  if jsonb_typeof(p_facts) is distinct from 'array' then
    raise exception 'Invalid source fact set' using errcode = '22023';
  end if;

  fact_count = jsonb_array_length(p_facts);
  if fact_count < 1 or fact_count > 64 then
    raise exception 'Invalid source fact set' using errcode = '22023';
  end if;

  select fact_set_fingerprint into stored_fact_set_fingerprint
  from public.source_items
  where user_id = p_user_id and id = p_source_item_id;
  if not found then
    return 'source-missing';
  end if;
  if stored_fact_set_fingerprint is null
    or stored_fact_set_fingerprint <> p_fact_set_fingerprint then
    return 'fact-integrity-conflict';
  end if;

  for candidate, candidate_position in
    select value, ordinality from jsonb_array_elements(p_facts) with ordinality
  loop
    if jsonb_typeof(candidate) is distinct from 'object' then
      raise exception 'Invalid source fact set' using errcode = '22023';
    end if;
    if candidate - array[
        'sourceItemId', 'normalizerVersion', 'ordinal', 'kind', 'certainty', 'value',
        'uncertaintyReason', 'provenance'
      ]::text[] <> '{}'::jsonb
      or jsonb_typeof(candidate -> 'sourceItemId') is distinct from 'string'
      or jsonb_typeof(candidate -> 'normalizerVersion') is distinct from 'number'
      or jsonb_typeof(candidate -> 'ordinal') is distinct from 'number'
      or jsonb_typeof(candidate -> 'kind') is distinct from 'string'
      or jsonb_typeof(candidate -> 'certainty') is distinct from 'string'
      or coalesce(candidate ->> 'normalizerVersion', '') <> p_normalizer_version::text
      or coalesce(candidate ->> 'ordinal', '') !~ '^(0|[1-9][0-9]*)$'
      or coalesce(candidate ->> 'kind', '') not in (
        'sender', 'date', 'amount', 'currency', 'merchant', 'location', 'reference'
      )
      or coalesce(candidate ->> 'certainty', '') not in ('certain', 'uncertain') then
      raise exception 'Invalid source fact set' using errcode = '22023';
    end if;
    if coalesce(candidate ->> 'sourceItemId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' then
      raise exception 'Invalid source fact set' using errcode = '22023';
    end if;
    if (candidate ->> 'sourceItemId')::uuid <> p_source_item_id then
      raise exception 'Invalid source fact set' using errcode = '22023';
    end if;
    if (candidate ->> 'ordinal')::numeric >= 64
      or (candidate ->> 'ordinal')::numeric <> candidate_position - 1
      or jsonb_typeof(candidate -> 'provenance') is distinct from 'array' then
      raise exception 'Invalid source fact set' using errcode = '22023';
    end if;
    if jsonb_array_length(candidate -> 'provenance') not between 1 and 16 then
      raise exception 'Invalid source fact set' using errcode = '22023';
    end if;

    if candidate ->> 'certainty' = 'certain' then
      if not candidate ? 'value'
        or candidate ? 'uncertaintyReason'
        or candidate - array[
          'sourceItemId', 'normalizerVersion', 'ordinal', 'kind', 'certainty', 'value', 'provenance'
      ]::text[] <> '{}'::jsonb then
        raise exception 'Invalid source fact set' using errcode = '22023';
      end if;
      if candidate ->> 'kind' in ('sender', 'amount', 'currency', 'merchant') then
        if jsonb_typeof(candidate -> 'value') is distinct from 'string' then
          raise exception 'Invalid source fact set' using errcode = '22023';
        end if;
      elsif candidate ->> 'kind' = 'date' then
        if jsonb_typeof(candidate -> 'value') is distinct from 'object'
          or not ((candidate -> 'value') ?& array['role', 'instant'])
          or (candidate -> 'value') - array['role', 'instant']::text[] <> '{}'::jsonb
          or jsonb_typeof((candidate -> 'value') -> 'role') is distinct from 'string'
          or jsonb_typeof((candidate -> 'value') -> 'instant') is distinct from 'string'
          or (candidate -> 'value') ->> 'role' not in (
            'occurred', 'captured', 'sent', 'received', 'transaction', 'due', 'start', 'end'
          )
          or public.is_canonical_fact_instant((candidate -> 'value') ->> 'instant') is not true then
          raise exception 'Invalid source fact set' using errcode = '22023';
        end if;
      elsif candidate ->> 'kind' = 'location' then
        if jsonb_typeof(candidate -> 'value') is distinct from 'object'
          or not ((candidate -> 'value') ? 'label')
          or (candidate -> 'value') - array['label', 'role']::text[] <> '{}'::jsonb
          or jsonb_typeof((candidate -> 'value') -> 'label') is distinct from 'string'
          or (
            (candidate -> 'value') ? 'role'
            and (
              jsonb_typeof((candidate -> 'value') -> 'role') is distinct from 'string'
              or (candidate -> 'value') ->> 'role' not in (
                'merchant', 'origin', 'destination', 'event', 'other'
              )
            )
          ) then
          raise exception 'Invalid source fact set' using errcode = '22023';
        end if;
      elsif candidate ->> 'kind' = 'reference' then
        if jsonb_typeof(candidate -> 'value') is distinct from 'object'
          or not ((candidate -> 'value') ?& array['kind', 'value'])
          or (candidate -> 'value') - array['kind', 'value']::text[] <> '{}'::jsonb
          or jsonb_typeof((candidate -> 'value') -> 'kind') is distinct from 'string'
          or jsonb_typeof((candidate -> 'value') -> 'value') is distinct from 'string'
          or (candidate -> 'value') ->> 'kind' not in (
            'transaction', 'order', 'tracking', 'booking', 'invoice', 'other'
          ) then
          raise exception 'Invalid source fact set' using errcode = '22023';
        end if;
      end if;
    elsif jsonb_typeof(candidate -> 'uncertaintyReason') is distinct from 'string'
      or candidate ? 'value'
      or coalesce(candidate ->> 'uncertaintyReason', '') not in ('invalid', 'contradictory')
      or candidate - array[
        'sourceItemId', 'normalizerVersion', 'ordinal', 'kind', 'certainty',
        'uncertaintyReason', 'provenance'
      ]::text[] <> '{}'::jsonb then
      raise exception 'Invalid source fact set' using errcode = '22023';
    end if;

    for evidence in select value from jsonb_array_elements(candidate -> 'provenance') loop
      if jsonb_typeof(evidence) is distinct from 'object' then
        raise exception 'Invalid source fact set' using errcode = '22023';
      end if;
      if evidence - array['field', 'start', 'end']::text[] <> '{}'::jsonb
        or jsonb_typeof(evidence -> 'field') is distinct from 'string'
        or char_length(evidence ->> 'field') > 160
        or coalesce(evidence ->> 'field', '') !~
          '^(sender|subject|body|occurredAt|capturedAt|attributes\.(sender|dates|amount|currency|merchant|location|reference)(\[[0-9]+\])?)$'
        or (evidence ? 'start') <> (evidence ? 'end') then
        raise exception 'Invalid source fact set' using errcode = '22023';
      end if;
      if evidence ? 'start' and (
        jsonb_typeof(evidence -> 'start') is distinct from 'number'
        or jsonb_typeof(evidence -> 'end') is distinct from 'number'
        or evidence ->> 'start' !~ '^(0|[1-9][0-9]*)$'
        or evidence ->> 'end' !~ '^[1-9][0-9]*$'
      ) then
        raise exception 'Invalid source fact set' using errcode = '22023';
      end if;
      if evidence ? 'start' and (
        (evidence ->> 'start')::numeric >= (evidence ->> 'end')::numeric
        or (evidence ->> 'end')::numeric > 1000000
      ) then
        raise exception 'Invalid source fact set' using errcode = '22023';
      end if;
    end loop;
  end loop;

  if (
    select count(distinct (value ->> 'ordinal')::integer) <> fact_count
      or min((value ->> 'ordinal')::integer) <> 0
      or max((value ->> 'ordinal')::integer) <> fact_count - 1
    from jsonb_array_elements(p_facts)
  ) then
    raise exception 'Invalid source fact set' using errcode = '22023';
  end if;

  insert into public.source_facts (
    user_id, source_item_id, normalizer_version, ordinal, kind, certainty, value,
    uncertainty_reason, provenance
  )
  select
    p_user_id,
    p_source_item_id,
    p_normalizer_version,
    (fact ->> 'ordinal')::integer,
    (fact ->> 'kind')::public.source_fact_kind,
    (fact ->> 'certainty')::public.source_fact_certainty,
    case when fact ? 'value' then fact -> 'value' else null end,
    case
      when fact ? 'uncertaintyReason'
      then (fact ->> 'uncertaintyReason')::public.source_fact_uncertainty_reason
      else null
    end,
    fact -> 'provenance'
  from jsonb_array_elements(p_facts) as facts(fact)
  on conflict (user_id, source_item_id, normalizer_version, ordinal) do nothing;
  get diagnostics inserted_count = row_count;

  select count(*) into existing_count
  from public.source_facts
  where user_id = p_user_id
    and source_item_id = p_source_item_id
    and normalizer_version = p_normalizer_version;

  if existing_count <> fact_count or exists (
    select 1
    from jsonb_array_elements(p_facts) as facts(fact)
    where not exists (
      select 1
      from public.source_facts
      where user_id = p_user_id
        and source_item_id = p_source_item_id
        and normalizer_version = p_normalizer_version
        and ordinal = (fact ->> 'ordinal')::integer
        and kind::text = fact ->> 'kind'
        and certainty::text = fact ->> 'certainty'
        and value is not distinct from case when fact ? 'value' then fact -> 'value' else null end
        and uncertainty_reason::text is not distinct from fact ->> 'uncertaintyReason'
        and provenance = fact -> 'provenance'
    )
  ) then
    raise exception 'Source fact version conflict' using errcode = '23505';
  end if;

  update public.source_items
  set processed_at = coalesce(processed_at, now())
  where user_id = p_user_id and id = p_source_item_id;

  return case when inserted_count > 0 then 'stored' else 'duplicate' end;
end;
$$;
