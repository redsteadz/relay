create type public.source_fact_kind as enum (
  'sender', 'date', 'amount', 'currency', 'merchant', 'location', 'reference'
);
create type public.source_fact_certainty as enum ('certain', 'uncertain');
create type public.source_fact_uncertainty_reason as enum ('invalid', 'contradictory');

create function public.is_canonical_fact_instant(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  parsed timestamptz;
begin
  if char_length(p_value) <> 30
    or left(p_value, 4) = '0000'
    or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{9}Z$' then
    return false;
  end if;
  parsed = (left(p_value, 19) || 'Z')::timestamptz;
  return to_char(parsed at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') = left(p_value, 19);
exception when others then
  return false;
end;
$$;

revoke all on function public.is_canonical_fact_instant(text) from public, anon, authenticated;
grant execute on function public.is_canonical_fact_instant(text) to service_role;

alter table public.source_items
add column fact_set_fingerprint text
check (fact_set_fingerprint is null or fact_set_fingerprint ~ '^[0-9a-f]{64}$');

create function public.persist_encrypted_source_item_v3(
  p_id uuid,
  p_user_id uuid,
  p_source public.source_kind,
  p_source_account_id text,
  p_external_id text,
  p_application_id text,
  p_occurred_at timestamptz,
  p_captured_at timestamptz,
  p_content_fingerprint text,
  p_fact_set_fingerprint text,
  p_accepted_at timestamptz,
  p_raw_expires_at timestamptz,
  p_encryption_environment text,
  p_raw_ciphertext bytea,
  p_raw_nonce bytea,
  p_wrapped_data_key bytea,
  p_wrap_nonce bytea,
  p_key_version integer
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected integer;
  conflicting_user_id uuid;
  stored_application_id text;
  stored_content_fingerprint text;
  stored_fact_set_fingerprint text;
  stored_external_id text;
  stored_source public.source_kind;
  stored_source_account_id text;
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
    or p_fact_set_fingerprint is null
    or p_fact_set_fingerprint !~ '^[0-9a-f]{64}$'
    or p_accepted_at is null
    or p_accepted_at > now() + interval '5 minutes'
    or p_raw_expires_at <> p_accepted_at + interval '7 days'
    or p_raw_expires_at <= now()
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
    fact_set_fingerprint,
    raw_expires_at,
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
    p_fact_set_fingerprint,
    p_raw_expires_at,
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
    return 'stored';
  end if;

  select
    user_id,
    source,
    source_account_id,
    external_id,
    application_id,
    content_fingerprint,
    fact_set_fingerprint
  into
    conflicting_user_id,
    stored_source,
    stored_source_account_id,
    stored_external_id,
    stored_application_id,
    stored_content_fingerprint,
    stored_fact_set_fingerprint
  from public.source_items
  where id = p_id;
  if found then
    if conflicting_user_id <> p_user_id then
      return 'tenant-conflict';
    end if;
    if stored_source <> p_source
      or stored_source_account_id is distinct from p_source_account_id
      or stored_external_id <> p_external_id
      or stored_application_id is distinct from p_application_id
      or stored_content_fingerprint <> p_content_fingerprint
      or stored_fact_set_fingerprint is null
      or stored_fact_set_fingerprint <> p_fact_set_fingerprint then
      return 'fact-integrity-conflict';
    end if;
    return 'duplicate';
  end if;

  if exists (
    select 1
    from public.source_items
    where user_id = p_user_id
      and (
        (
          source = p_source
          and source_account_id is not distinct from p_source_account_id
          and external_id = p_external_id
        )
        or content_fingerprint = p_content_fingerprint
      )
  ) then
    return 'duplicate';
  end if;

  return 'tenant-conflict';
end;
$$;

revoke all on function public.persist_encrypted_source_item_v3(
  uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer
) from public, anon, authenticated;
grant execute on function public.persist_encrypted_source_item_v3(
  uuid, uuid, public.source_kind, text, text, text, timestamptz, timestamptz, text, text,
  timestamptz, timestamptz, text, bytea, bytea, bytea, bytea, integer
) to service_role;

create table public.source_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_item_id uuid not null,
  normalizer_version integer not null check (normalizer_version > 0),
  ordinal integer not null check (ordinal >= 0 and ordinal < 64),
  kind public.source_fact_kind not null,
  certainty public.source_fact_certainty not null,
  value jsonb,
  uncertainty_reason public.source_fact_uncertainty_reason,
  provenance jsonb not null check (
    jsonb_typeof(provenance) = 'array'
    and jsonb_array_length(provenance) between 1 and 16
  ),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, source_item_id, normalizer_version, ordinal),
  foreign key (user_id, source_item_id) references public.source_items(user_id, id)
    on delete cascade,
  check (
    (
      certainty = 'certain'
      and value is not null
      and uncertainty_reason is null
    )
    or
    (
      certainty = 'uncertain'
      and value is null
      and uncertainty_reason is not null
    )
  ),
  check (
    certainty = 'uncertain'
    or kind not in ('sender', 'merchant')
    or (
      jsonb_typeof(value) = 'string'
      and char_length(value #>> '{}') between 1 and 1024
      and value #>> '{}' = btrim(value #>> '{}')
    )
  ),
  check (
    certainty = 'uncertain'
    or kind <> 'date'
    or (
      jsonb_typeof(value) = 'object'
      and value ?& array['role', 'instant']
      and value - array['role', 'instant']::text[] = '{}'::jsonb
      and jsonb_typeof(value -> 'role') = 'string'
      and jsonb_typeof(value -> 'instant') = 'string'
      and value ->> 'role' in (
        'occurred', 'captured', 'sent', 'received', 'transaction', 'due', 'start', 'end'
      )
      and public.is_canonical_fact_instant(value ->> 'instant') is true
    )
  ),
  check (
    certainty = 'uncertain'
    or kind <> 'amount'
    or (
      jsonb_typeof(value) = 'string'
      and char_length(value #>> '{}') between 1 and 128
      and value #>> '{}' ~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$'
    )
  ),
  check (
    certainty = 'uncertain'
    or kind <> 'currency'
    or (jsonb_typeof(value) = 'string' and value #>> '{}' ~ '^[A-Z]{3}$')
  ),
  check (
    certainty = 'uncertain'
    or kind <> 'location'
    or (
      jsonb_typeof(value) = 'object'
      and value ? 'label'
      and value - array['label', 'role']::text[] = '{}'::jsonb
      and jsonb_typeof(value -> 'label') = 'string'
      and char_length(value ->> 'label') between 1 and 1024
      and value ->> 'label' = btrim(value ->> 'label')
      and (
        not (value ? 'role')
        or (
          jsonb_typeof(value -> 'role') = 'string'
          and value ->> 'role' in ('merchant', 'origin', 'destination', 'event', 'other')
        )
      )
    )
  ),
  check (
    certainty = 'uncertain'
    or kind <> 'reference'
    or (
      jsonb_typeof(value) = 'object'
      and value ?& array['kind', 'value']
      and value - array['kind', 'value']::text[] = '{}'::jsonb
      and jsonb_typeof(value -> 'kind') = 'string'
      and jsonb_typeof(value -> 'value') = 'string'
      and value ->> 'kind' in ('transaction', 'order', 'tracking', 'booking', 'invoice', 'other')
      and char_length(value ->> 'value') between 1 and 1024
      and value ->> 'value' = btrim(value ->> 'value')
    )
  )
);

alter table public.source_facts enable row level security;
create policy "users view own source facts" on public.source_facts
for select using ((select auth.uid()) = user_id);

grant select on public.source_facts to authenticated;
grant all on public.source_facts to service_role;

create function public.persist_source_facts(
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
          '^(sender|occurredAt|capturedAt|attributes\.(sender|dates|amount|currency|merchant|location|reference)(\[[0-9]+\])?)$'
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

revoke all on function public.persist_source_facts(uuid, uuid, text, integer, jsonb)
from public, anon, authenticated;
grant execute on function public.persist_source_facts(uuid, uuid, text, integer, jsonb) to service_role;

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
  'persistence_response_invalid',
  'coordinator_unavailable',
  'retry_exhausted_unknown'
));

alter table public.dead_letter_items
add column encryption_aad_user_id text,
add column encryption_aad_envelope_id text,
add constraint dead_letter_items_encryption_aad_ids_check check (
  (
    encryption_aad_user_id is null
    and encryption_aad_envelope_id is null
  )
  or
  (
    encryption_aad_user_id ~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$'
    and encryption_aad_envelope_id ~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$'
    and lower(encryption_aad_user_id) = user_id::text
    and lower(encryption_aad_envelope_id) = envelope_id::text
  )
);

drop function public.record_dead_letter_item(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text,
  bytea, bytea, bytea, bytea, integer, uuid
);

create function public.record_dead_letter_item(
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
      'fact_integrity_conflict', 'persistence_response_invalid',
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
      (
        is_expired
        and dead_letter_items.status in ('available', 'replaying')
      )
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

revoke all on function public.record_dead_letter_item(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text,
  bytea, bytea, bytea, bytea, integer, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.record_dead_letter_item(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text,
  bytea, bytea, bytea, bytea, integer, uuid, text, text
) to service_role;

drop function public.claim_dead_letter_replay(uuid, uuid);

create function public.claim_dead_letter_replay(p_id uuid, p_request_id uuid)
returns table (
  id uuid,
  user_id uuid,
  envelope_id uuid,
  encryption_aad_user_id text,
  encryption_aad_envelope_id text,
  accepted_at timestamptz,
  raw_expires_at timestamptz,
  encryption_environment text,
  ciphertext bytea,
  nonce bytea,
  wrapped_data_key bytea,
  wrap_nonce bytea,
  key_version integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed public.dead_letter_items;
  newly_claimed boolean;
begin
  if p_id is null or p_request_id is null then
    raise exception 'Invalid replay claim' using errcode = '22023';
  end if;

  update public.dead_letter_items as item
  set status = 'expired',
      encryption_environment = null,
      ciphertext = null,
      nonce = null,
      wrapped_data_key = null,
      wrap_nonce = null,
      key_version = null,
      replay_request_id = null,
      completed_at = coalesce(item.completed_at, now())
  where item.id = p_id
    and item.raw_expires_at <= now()
    and item.ciphertext is not null;

  update public.dead_letter_items as item
  set status = 'replaying',
      replay_request_id = p_request_id,
      replay_count = item.replay_count + 1,
      last_replayed_at = now()
  where item.id = p_id
    and item.status = 'available'
    and item.raw_expires_at > now()
    and item.ciphertext is not null
  returning item.* into claimed;
  newly_claimed := found;

  if not found then
    select * into claimed
    from public.dead_letter_items as item
    where item.id = p_id
      and item.status = 'replaying'
      and item.replay_request_id = p_request_id
      and item.raw_expires_at > now()
      and item.ciphertext is not null;
  end if;

  if claimed.id is null then
    return;
  end if;

  if newly_claimed then
    insert into public.audit_log (
      user_id, actor_type, actor_id, action, target_type, target_id, metadata
    ) values (
      claimed.user_id,
      'system',
      'recovery-api',
      'dead_letter.replay_requested',
      'dead_letter_item',
      claimed.id::text,
      jsonb_build_object('requestId', p_request_id)
    );
  end if;

  return query select
    claimed.id,
    claimed.user_id,
    claimed.envelope_id,
    claimed.encryption_aad_user_id,
    claimed.encryption_aad_envelope_id,
    claimed.accepted_at,
    claimed.raw_expires_at,
    claimed.encryption_environment,
    claimed.ciphertext,
    claimed.nonce,
    claimed.wrapped_data_key,
    claimed.wrap_nonce,
    claimed.key_version;
end;
$$;

revoke all on function public.claim_dead_letter_replay(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.claim_dead_letter_replay(uuid, uuid) to service_role;
