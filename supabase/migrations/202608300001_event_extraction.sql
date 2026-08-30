alter table public.relay_events
add column normalizer_version integer,
add column extractor_version integer,
add column ordinal integer,
add column event_set_fingerprint text,
add column temporal_status text,
add column time_zone text,
add column starts_at_canonical text,
add column ends_at timestamptz,
add column ends_at_canonical text,
add column due_at_canonical text,
add column date_ambiguity text,
add column requires_review boolean;

alter table public.relay_events
add constraint relay_events_extraction_shape_check check ((
  (
    extractor_version is null
    and normalizer_version is null
    and ordinal is null
    and event_set_fingerprint is null
    and temporal_status is null
    and time_zone is null
    and starts_at_canonical is null
    and ends_at is null
    and ends_at_canonical is null
    and due_at_canonical is null
    and date_ambiguity is null
    and requires_review is null
  )
  or
  (
    extractor_version > 0
    and normalizer_version > 0
    and ordinal between 0 and 15
    and event_set_fingerprint ~ '^[0-9a-f]{64}$'
    and char_length(title) between 1 and 160
    and title = btrim(title)
    and char_length(summary) between 1 and 280
    and summary = btrim(summary)
    and jsonb_typeof(provenance) = 'array'
    and jsonb_array_length(provenance) between 1 and 16
    and temporal_status in ('none', 'resolved', 'ambiguous')
    and requires_review = (confidence < 0.8 or temporal_status = 'ambiguous')
    and (
      (
        temporal_status = 'none'
        and kind in ('task', 'fact')
        and time_zone is null
        and starts_at is null
        and starts_at_canonical is null
        and ends_at is null
        and ends_at_canonical is null
        and due_at is null
        and due_at_canonical is null
        and date_ambiguity is null
      )
      or
      (
        temporal_status = 'ambiguous'
        and time_zone is null
        and starts_at is null
        and starts_at_canonical is null
        and ends_at is null
        and ends_at_canonical is null
        and due_at is null
        and due_at_canonical is null
        and date_ambiguity in ('invalid', 'contradictory', 'inconsistent-range')
      )
      or
      (
        temporal_status = 'resolved'
        and time_zone = 'UTC'
        and date_ambiguity is null
        and (
          (
            kind = 'calendar-event'
            and starts_at_canonical is not null
            and due_at is null
            and due_at_canonical is null
          )
          or
          (
            kind in ('task', 'reminder')
            and starts_at is null
            and starts_at_canonical is null
            and ends_at is null
            and ends_at_canonical is null
            and due_at_canonical is not null
          )
        )
        and (
          case when starts_at_canonical is null then starts_at is null
          when public.is_canonical_fact_instant(starts_at_canonical) is true
          then starts_at = starts_at_canonical::timestamptz
          else false end
        )
        and (
          case when ends_at_canonical is null then ends_at is null
          when public.is_canonical_fact_instant(ends_at_canonical) is true
          then ends_at = ends_at_canonical::timestamptz
          else false end
        )
        and (
          case when due_at_canonical is null then due_at is null
          when public.is_canonical_fact_instant(due_at_canonical) is true
          then due_at = due_at_canonical::timestamptz
          else false end
        )
        and (
          starts_at_canonical is null
          or ends_at_canonical is null
          or ends_at_canonical > starts_at_canonical
        )
      )
    )
  )
) is true);

create unique index relay_events_source_extractor_ordinal_idx
on public.relay_events (
  user_id, source_item_id, normalizer_version, extractor_version, ordinal
)
where extractor_version is not null;

create function public.persist_source_events(
  p_user_id uuid,
  p_source_item_id uuid,
  p_fact_set_fingerprint text,
  p_normalizer_version integer,
  p_extractor_version integer,
  p_event_set_fingerprint text,
  p_events jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  candidate jsonb;
  candidate_position bigint;
  event_count integer;
  evidence jsonb;
  existing_count integer;
  inserted_count integer;
  stored_fact_set_fingerprint text;
begin
  if p_user_id is null
    or p_source_item_id is null
    or p_fact_set_fingerprint is null
    or p_fact_set_fingerprint !~ '^[0-9a-f]{64}$'
    or p_normalizer_version is null
    or p_normalizer_version <= 0
    or p_extractor_version is null
    or p_extractor_version <= 0
    or p_event_set_fingerprint is null
    or p_event_set_fingerprint !~ '^[0-9a-f]{64}$'
    or p_events is null
    or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'Invalid source event set' using errcode = '22023';
  end if;

  event_count = jsonb_array_length(p_events);
  if event_count < 1 or event_count > 16 then
    raise exception 'Invalid source event set' using errcode = '22023';
  end if;

  select fact_set_fingerprint into stored_fact_set_fingerprint
  from public.source_items
  where user_id = p_user_id and id = p_source_item_id;
  if not found then
    return 'source-missing';
  end if;
  if stored_fact_set_fingerprint is null
    or stored_fact_set_fingerprint <> p_fact_set_fingerprint then
    return 'event-integrity-conflict';
  end if;
  if not exists (
    select 1 from public.source_facts
    where user_id = p_user_id
      and source_item_id = p_source_item_id
      and normalizer_version = p_normalizer_version
  ) then
    return 'facts-missing';
  end if;

  for candidate, candidate_position in
    select value, ordinality from jsonb_array_elements(p_events) with ordinality
  loop
    if jsonb_typeof(candidate) is distinct from 'object'
      or candidate - array[
        'sourceItemId', 'normalizerVersion', 'extractorVersion', 'ordinal', 'kind', 'title',
        'summary', 'confidence', 'requiresReview', 'temporalStatus', 'timeZone', 'startsAt',
        'endsAt', 'dueAt', 'dateAmbiguity', 'provenance'
      ]::text[] <> '{}'::jsonb
      or not (candidate ?& array[
        'sourceItemId', 'normalizerVersion', 'extractorVersion', 'ordinal', 'kind', 'title',
        'summary', 'confidence', 'requiresReview', 'temporalStatus', 'timeZone', 'provenance'
      ])
      or jsonb_typeof(candidate -> 'sourceItemId') is distinct from 'string'
      or jsonb_typeof(candidate -> 'normalizerVersion') is distinct from 'number'
      or jsonb_typeof(candidate -> 'extractorVersion') is distinct from 'number'
      or jsonb_typeof(candidate -> 'ordinal') is distinct from 'number'
      or jsonb_typeof(candidate -> 'kind') is distinct from 'string'
      or jsonb_typeof(candidate -> 'title') is distinct from 'string'
      or jsonb_typeof(candidate -> 'summary') is distinct from 'string'
      or jsonb_typeof(candidate -> 'confidence') is distinct from 'number'
      or jsonb_typeof(candidate -> 'requiresReview') is distinct from 'boolean'
      or jsonb_typeof(candidate -> 'temporalStatus') is distinct from 'string'
      or jsonb_typeof(candidate -> 'provenance') is distinct from 'array' then
      raise exception 'Invalid source event set' using errcode = '22023';
    end if;
    if coalesce(candidate ->> 'sourceItemId', '') !~* '^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'
      or (candidate ->> 'sourceItemId')::uuid <> p_source_item_id
      or coalesce(candidate ->> 'normalizerVersion', '') !~ '^[1-9][0-9]*$'
      or (candidate ->> 'normalizerVersion')::numeric <> p_normalizer_version
      or coalesce(candidate ->> 'extractorVersion', '') !~ '^[1-9][0-9]*$'
      or (candidate ->> 'extractorVersion')::numeric <> p_extractor_version
      or coalesce(candidate ->> 'ordinal', '') !~ '^(0|[1-9][0-9]*)$'
      or (candidate ->> 'ordinal')::numeric <> candidate_position - 1
      or (candidate ->> 'ordinal')::numeric >= 16
      or candidate ->> 'kind' not in ('task', 'reminder', 'calendar-event', 'fact')
      or char_length(candidate ->> 'title') not between 1 and 160
      or candidate ->> 'title' <> btrim(candidate ->> 'title')
      or char_length(candidate ->> 'summary') not between 1 and 280
      or candidate ->> 'summary' <> btrim(candidate ->> 'summary')
      or (candidate ->> 'confidence')::numeric < 0
      or (candidate ->> 'confidence')::numeric > 1
      or (candidate ->> 'confidence')::numeric <> round((candidate ->> 'confidence')::numeric, 3)
      or candidate ->> 'temporalStatus' not in ('none', 'resolved', 'ambiguous')
      or jsonb_array_length(candidate -> 'provenance') not between 1 and 16 then
      raise exception 'Invalid source event set' using errcode = '22023';
    end if;
    if (candidate ->> 'requiresReview')::boolean is distinct from (
      (candidate ->> 'confidence')::numeric < 0.8
      or candidate ->> 'temporalStatus' = 'ambiguous'
    ) then
      raise exception 'Invalid source event set' using errcode = '22023';
    end if;

    if candidate ? 'startsAt' and (
      jsonb_typeof(candidate -> 'startsAt') is distinct from 'string'
      or public.is_canonical_fact_instant(candidate ->> 'startsAt') is not true
    ) then
      raise exception 'Invalid source event set' using errcode = '22023';
    end if;
    if candidate ? 'endsAt' and (
      jsonb_typeof(candidate -> 'endsAt') is distinct from 'string'
      or public.is_canonical_fact_instant(candidate ->> 'endsAt') is not true
    ) then
      raise exception 'Invalid source event set' using errcode = '22023';
    end if;
    if candidate ? 'dueAt' and (
      jsonb_typeof(candidate -> 'dueAt') is distinct from 'string'
      or public.is_canonical_fact_instant(candidate ->> 'dueAt') is not true
    ) then
      raise exception 'Invalid source event set' using errcode = '22023';
    end if;
    if candidate ? 'startsAt' and candidate ? 'endsAt'
      and candidate ->> 'endsAt' <= candidate ->> 'startsAt' then
      raise exception 'Invalid source event set' using errcode = '22023';
    end if;

    if candidate ->> 'temporalStatus' = 'none' then
      if candidate ->> 'kind' not in ('task', 'fact')
        or jsonb_typeof(candidate -> 'timeZone') is distinct from 'null'
        or candidate ?| array['startsAt', 'endsAt', 'dueAt', 'dateAmbiguity'] then
        raise exception 'Invalid source event set' using errcode = '22023';
      end if;
    elsif candidate ->> 'temporalStatus' = 'ambiguous' then
      if jsonb_typeof(candidate -> 'timeZone') is distinct from 'null'
        or candidate ?| array['startsAt', 'endsAt', 'dueAt']
        or jsonb_typeof(candidate -> 'dateAmbiguity') is distinct from 'string'
        or candidate ->> 'dateAmbiguity' not in ('invalid', 'contradictory', 'inconsistent-range') then
        raise exception 'Invalid source event set' using errcode = '22023';
      end if;
    else
      if jsonb_typeof(candidate -> 'timeZone') is distinct from 'string'
        or candidate ->> 'timeZone' <> 'UTC'
        or candidate ? 'dateAmbiguity'
        or (
          candidate ->> 'kind' = 'calendar-event'
          and (not (candidate ? 'startsAt') or candidate ? 'dueAt')
        )
        or (
          candidate ->> 'kind' in ('task', 'reminder')
          and (not (candidate ? 'dueAt') or candidate ?| array['startsAt', 'endsAt'])
        )
        or candidate ->> 'kind' = 'fact' then
        raise exception 'Invalid source event set' using errcode = '22023';
      end if;
    end if;

    for evidence in select value from jsonb_array_elements(candidate -> 'provenance') loop
      if jsonb_typeof(evidence) is distinct from 'object'
        or evidence - array['factOrdinal', 'fields']::text[] <> '{}'::jsonb
        or not (evidence ?& array['factOrdinal', 'fields'])
        or jsonb_typeof(evidence -> 'factOrdinal') is distinct from 'number'
        or coalesce(evidence ->> 'factOrdinal', '') !~ '^(0|[1-9][0-9]*)$'
        or (evidence ->> 'factOrdinal')::numeric >= 64
        or jsonb_typeof(evidence -> 'fields') is distinct from 'array'
        or jsonb_array_length(evidence -> 'fields') not between 1 and 16
        or not exists (
          select 1 from public.source_facts
          where user_id = p_user_id
            and source_item_id = p_source_item_id
            and normalizer_version = p_normalizer_version
            and ordinal = (evidence ->> 'factOrdinal')::integer
            and provenance = evidence -> 'fields'
        ) then
        raise exception 'Invalid source event set' using errcode = '22023';
      end if;
    end loop;
    if (
      select count(distinct (value ->> 'factOrdinal')::integer)
        <> jsonb_array_length(candidate -> 'provenance')
      from jsonb_array_elements(candidate -> 'provenance')
    ) then
      raise exception 'Invalid source event set' using errcode = '22023';
    end if;
  end loop;

  insert into public.relay_events (
    user_id, source_item_id, normalizer_version, extractor_version, ordinal,
    event_set_fingerprint, kind, title, summary, confidence, requires_review,
    temporal_status, time_zone, starts_at, starts_at_canonical, ends_at,
    ends_at_canonical, due_at, due_at_canonical, date_ambiguity, provenance
  )
  select
    p_user_id,
    p_source_item_id,
    p_normalizer_version,
    p_extractor_version,
    (event ->> 'ordinal')::integer,
    p_event_set_fingerprint,
    (event ->> 'kind')::public.event_kind,
    event ->> 'title',
    event ->> 'summary',
    (event ->> 'confidence')::numeric,
    (event ->> 'requiresReview')::boolean,
    event ->> 'temporalStatus',
    event ->> 'timeZone',
    case when event ? 'startsAt' then (event ->> 'startsAt')::timestamptz else null end,
    event ->> 'startsAt',
    case when event ? 'endsAt' then (event ->> 'endsAt')::timestamptz else null end,
    event ->> 'endsAt',
    case when event ? 'dueAt' then (event ->> 'dueAt')::timestamptz else null end,
    event ->> 'dueAt',
    event ->> 'dateAmbiguity',
    event -> 'provenance'
  from jsonb_array_elements(p_events) as events(event)
  on conflict (user_id, source_item_id, normalizer_version, extractor_version, ordinal)
    where extractor_version is not null do nothing;
  get diagnostics inserted_count = row_count;

  select count(*) into existing_count
  from public.relay_events
  where user_id = p_user_id
    and source_item_id = p_source_item_id
    and normalizer_version = p_normalizer_version
    and extractor_version = p_extractor_version;

  if existing_count <> event_count or exists (
    select 1
    from jsonb_array_elements(p_events) as events(event)
    where not exists (
      select 1 from public.relay_events
      where user_id = p_user_id
        and source_item_id = p_source_item_id
        and normalizer_version = p_normalizer_version
        and extractor_version = p_extractor_version
        and ordinal = (event ->> 'ordinal')::integer
        and event_set_fingerprint = p_event_set_fingerprint
        and kind::text = event ->> 'kind'
        and title = event ->> 'title'
        and summary = event ->> 'summary'
        and confidence = (event ->> 'confidence')::numeric
        and requires_review = (event ->> 'requiresReview')::boolean
        and temporal_status = event ->> 'temporalStatus'
        and time_zone is not distinct from event ->> 'timeZone'
        and starts_at_canonical is not distinct from event ->> 'startsAt'
        and ends_at_canonical is not distinct from event ->> 'endsAt'
        and due_at_canonical is not distinct from event ->> 'dueAt'
        and date_ambiguity is not distinct from event ->> 'dateAmbiguity'
        and provenance = event -> 'provenance'
    )
  ) then
    raise exception 'Source event version conflict' using errcode = '23505';
  end if;

  return case when inserted_count > 0 then 'stored' else 'duplicate' end;
end;
$$;

revoke all on function public.persist_source_events(uuid, uuid, text, integer, integer, text, jsonb)
from public, anon, authenticated;
grant execute on function public.persist_source_events(uuid, uuid, text, integer, integer, text, jsonb)
to service_role;

alter table public.dead_letter_items
drop constraint dead_letter_items_failure_code_check;
alter table public.dead_letter_items
add constraint dead_letter_items_failure_code_check check (failure_code in (
  'configuration_invalid',
  'key_version_unavailable',
  'ciphertext_invalid',
  'envelope_invalid',
  'persistence_unavailable',
  'tenant_id_conflict',
  'fact_integrity_conflict',
  'event_integrity_conflict',
  'persistence_response_invalid',
  'coordinator_unavailable',
  'retry_exhausted_unknown'
));

create or replace function public.record_dead_letter_item(
  p_id uuid,
  p_user_id uuid,
  p_envelope_id uuid,
  p_failure_code text,
  p_accepted_at timestamptz,
  p_raw_expires_at timestamptz,
  p_encryption_environment text,
  p_ciphertext bytea,
  p_nonce bytea,
  p_wrapped_data_key bytea,
  p_wrap_nonce bytea,
  p_key_version integer,
  p_replay_request_id uuid,
  p_encryption_aad_user_id text default null,
  p_encryption_aad_envelope_id text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
  is_expired boolean := p_raw_expires_at <= now();
begin
  if p_id is null
    or p_user_id is null
    or p_envelope_id is null
    or p_failure_code not in (
      'configuration_invalid', 'key_version_unavailable', 'ciphertext_invalid',
      'envelope_invalid', 'persistence_unavailable', 'tenant_id_conflict',
      'fact_integrity_conflict', 'event_integrity_conflict', 'persistence_response_invalid',
      'coordinator_unavailable', 'retry_exhausted_unknown'
    )
    or p_accepted_at is null
    or p_raw_expires_at <> p_accepted_at + interval '7 days'
    or p_encryption_environment not in ('development', 'production')
    or p_ciphertext is null
    or octet_length(p_ciphertext) < 16
    or p_nonce is null
    or octet_length(p_nonce) <> 12
    or p_wrapped_data_key is null
    or octet_length(p_wrapped_data_key) <> 48
    or p_wrap_nonce is null
    or octet_length(p_wrap_nonce) <> 12
    or p_key_version is null
    or p_key_version <= 0
    or (p_encryption_aad_user_id is null) <> (p_encryption_aad_envelope_id is null)
    or (
      p_encryption_aad_user_id is not null
      and (
        p_encryption_aad_user_id !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$'
        or p_encryption_aad_envelope_id !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$'
        or lower(p_encryption_aad_user_id) <> p_user_id::text
        or lower(p_encryption_aad_envelope_id) <> p_envelope_id::text
      )
    ) then
    raise exception 'Invalid dead-letter item' using errcode = '22023';
  end if;

  insert into public.dead_letter_items (
    id, user_id, envelope_id, failure_code, status, accepted_at, raw_expires_at,
    encryption_environment, ciphertext, nonce, wrapped_data_key, wrap_nonce, key_version,
    encryption_aad_user_id, encryption_aad_envelope_id
  ) values (
    p_id,
    p_user_id,
    p_envelope_id,
    p_failure_code,
    case when is_expired then 'expired' else 'available' end,
    p_accepted_at,
    p_raw_expires_at,
    case when is_expired then null else p_encryption_environment end,
    case when is_expired then null else p_ciphertext end,
    case when is_expired then null else p_nonce end,
    case when is_expired then null else p_wrapped_data_key end,
    case when is_expired then null else p_wrap_nonce end,
    case when is_expired then null else p_key_version end,
    p_encryption_aad_user_id,
    p_encryption_aad_envelope_id
  )
  on conflict (id) do update
  set failure_code = case
        when dead_letter_items.failure_code <> 'retry_exhausted_unknown'
          and excluded.failure_code = 'retry_exhausted_unknown'
        then dead_letter_items.failure_code
        else excluded.failure_code
      end,
      status = case when is_expired then 'expired' else dead_letter_items.status end,
      encryption_environment = case
        when is_expired then null else dead_letter_items.encryption_environment
      end,
      ciphertext = case when is_expired then null else dead_letter_items.ciphertext end,
      nonce = case when is_expired then null else dead_letter_items.nonce end,
      wrapped_data_key = case when is_expired then null else dead_letter_items.wrapped_data_key end,
      wrap_nonce = case when is_expired then null else dead_letter_items.wrap_nonce end,
      key_version = case when is_expired then null else dead_letter_items.key_version end,
      replay_request_id = case
        when is_expired then null else dead_letter_items.replay_request_id
      end,
      last_failed_at = now(),
      completed_at = case when is_expired then now() else dead_letter_items.completed_at end
  where dead_letter_items.user_id = excluded.user_id
    and dead_letter_items.envelope_id = excluded.envelope_id
    and (
      dead_letter_items.encryption_aad_user_id is null
      or dead_letter_items.encryption_aad_user_id = excluded.encryption_aad_user_id
    )
    and (
      dead_letter_items.encryption_aad_envelope_id is null
      or dead_letter_items.encryption_aad_envelope_id = excluded.encryption_aad_envelope_id
    )
    and dead_letter_items.accepted_at = excluded.accepted_at
    and dead_letter_items.raw_expires_at = excluded.raw_expires_at
    and (
      (is_expired and dead_letter_items.status in ('available', 'replaying'))
      or
      (
        not is_expired
        and p_replay_request_id is not null
        and dead_letter_items.status = 'replaying'
        and dead_letter_items.replay_request_id = p_replay_request_id
      )
    );

  get diagnostics affected = row_count;
  if affected <> 1 then
    if exists (
      select 1
      from public.dead_letter_items
      where id = p_id
        and user_id = p_user_id
        and envelope_id = p_envelope_id
        and accepted_at = p_accepted_at
        and raw_expires_at = p_raw_expires_at
    ) then
      return false;
    end if;
    raise exception 'Dead-letter identity conflict' using errcode = '23505';
  end if;

  insert into public.audit_log (
    user_id, actor_type, actor_id, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    'system',
    'pipeline',
    case
      when is_expired then 'dead_letter.expired'
      when p_replay_request_id is not null then 'dead_letter.replay_failed'
      else 'dead_letter.recorded'
    end,
    'dead_letter_item',
    p_id::text,
    jsonb_build_object('failureCode', p_failure_code)
  );

  return not is_expired;
end;
$$;
