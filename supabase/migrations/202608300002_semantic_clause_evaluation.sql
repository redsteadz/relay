-- Semantic clause evaluation and disclosure audit (issue #28).
--
-- Deterministic predicates already decide most plans. This migration records what happened on the
-- remaining path: which allowlisted fields were disclosed to the tenant's own OpenAI key, what
-- classes of value were redacted first, what the model answered, and whether Relay could use that
-- answer at all. Every constraint here exists so the record cannot drift into holding content.

-- Written as an explicit loop rather than a single boolean expression. SQL does not guarantee that
-- `and`/`or` short-circuit, so a set-returning `jsonb_object_keys` could be evaluated against a
-- scalar array element and raise a type error instead of failing the check cleanly.
create function public.ai_disclosure_redactions_are_metadata(p_value jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  element jsonb;
  redaction_key text;
begin
  if jsonb_typeof(p_value) <> 'array' then
    return false;
  end if;

  for element in select entry.value from jsonb_array_elements(p_value) as entry(value)
  loop
    if jsonb_typeof(element) <> 'object' then
      return false;
    end if;

    for redaction_key in select keys.name from jsonb_object_keys(element) as keys(name)
    loop
      if redaction_key not in ('field', 'kind', 'count') then
        return false;
      end if;
    end loop;

    if element ->> 'field' is null
      or element ->> 'kind' is null
      or jsonb_typeof(element -> 'count') <> 'number'
    then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.ai_disclosure_redactions_are_metadata(jsonb)
from public, anon, authenticated;
grant execute on function public.ai_disclosure_redactions_are_metadata(jsonb) to service_role;

-- `decision` defaults to the conservative value rather than being required. A disclosure row that
-- does not say what Relay concluded has, by definition, not concluded anything.
alter table public.ai_disclosures
  add column decision text not null default 'undecided',
  add column disclosed boolean not null default true,
  add column confidence numeric(4, 3),
  add column rationale text,
  add column failure_reason text,
  -- The endpoint is configurable, so `provider = 'openai'` records the wire protocol and credential
  -- type, not where the data went. The host is the part that says that, and it is the only part of
  -- the endpoint kept: no scheme, port, path, query, or credential.
  add column endpoint_host text;

alter table public.ai_disclosures
  add constraint ai_disclosures_decision_known check (
    decision in ('match', 'no-match', 'undecided')
  ),
  add constraint ai_disclosures_confidence_range check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  add constraint ai_disclosures_rationale_bounded check (
    rationale is null or (btrim(rationale) <> '' and char_length(rationale) <= 500)
  ),
  add constraint ai_disclosures_endpoint_host_bounded check (
    endpoint_host is null
    or (
      btrim(endpoint_host) = endpoint_host
      and char_length(endpoint_host) between 1 and 255
      and endpoint_host !~ '[[:space:]/?#@]'
    )
  ),
  -- Present exactly when something was sent: a disclosure has to say where it went, and an attempt
  -- that sent nothing must not name a host it never contacted.
  add constraint ai_disclosures_disclosed_names_endpoint check (
    (endpoint_host is not null) = disclosed
  ),
  add constraint ai_disclosures_failure_reason_known check (
    failure_reason is null or failure_reason in (
      'credential-missing',
      'credential-revoked',
      'endpoint-invalid',
      'invalid-response',
      'no-disclosable-fields',
      'quota-exhausted',
      'rate-limited',
      'response-too-large',
      'timed-out',
      'unavailable'
    )
  ),
  -- A provider failure is never a decision. Recording one alongside `match` would let an outage
  -- read as a rule that fired, which is exactly what the tri-state exists to prevent.
  add constraint ai_disclosures_failure_is_undecided check (
    failure_reason is null or (decision = 'undecided' and confidence is null)
  ),
  -- Nothing was sent, so nothing can be reported as sent.
  add constraint ai_disclosures_undisclosed_is_empty check (
    disclosed or (disclosed_fields = '{}'::text[] and redactions = '[]'::jsonb)
  ),
  add constraint ai_disclosures_disclosed_fields_known check (
    disclosed_fields <@ array[
      'source.kind',
      'source.applicationId',
      'sender',
      'subject',
      'body',
      'category',
      'attributes.currency',
      'attributes.merchant',
      'attributes.amount'
    ]::text[]
  ),
  add constraint ai_disclosures_redactions_metadata_only check (
    public.ai_disclosure_redactions_are_metadata(redactions)
  );

create index ai_disclosures_user_created_idx
  on public.ai_disclosures (user_id, created_at desc);

-- A disclosure is an audit record of something that already left the runtime. It cannot be edited
-- or withdrawn after the fact; whole-account deletion still removes it through the foreign-key
-- cascade from `auth.users`.
create function public.enforce_ai_disclosure_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    -- Whole-account deletion reaches this trigger through nested foreign-key cascades.
    if tg_op = 'DELETE' then
      return old;
    end if;
    -- `filter_rules` is referenced `on delete set null (filter_rule_id)`, so a cascade that removes
    -- a filter revision detaches it here as a nested update. That single transition is permitted;
    -- no other column may change, and the disclosure itself still cannot be rewritten.
    if new.filter_rule_id is null
      and (to_jsonb(new) - 'filter_rule_id') = (to_jsonb(old) - 'filter_rule_id')
    then
      return new;
    end if;
  end if;
  raise exception 'AI disclosures are immutable' using errcode = '55000';
end;
$$;

create trigger ai_disclosures_immutable
before update or delete on public.ai_disclosures
for each row execute function public.enforce_ai_disclosure_immutability();

revoke insert, update, delete on public.ai_disclosures from authenticated, service_role;

create function public.record_semantic_disclosure_v1(
  p_user_id uuid,
  p_source_item_id uuid,
  p_filter_rule_id uuid,
  p_model text,
  p_purpose text,
  p_decision text,
  p_disclosed boolean,
  p_disclosed_fields text[],
  p_redactions jsonb,
  p_endpoint_host text,
  p_confidence numeric default null,
  p_rationale text default null,
  p_failure_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  disclosure_id uuid;
begin
  if p_user_id is null or p_source_item_id is null then
    raise exception 'Disclosure tenant and source item are required' using errcode = '22023';
  end if;
  if p_model is null or btrim(p_model) = '' or char_length(p_model) > 128 then
    raise exception 'Disclosure model must contain 1 to 128 characters' using errcode = '22023';
  end if;
  if p_purpose is null or btrim(p_purpose) = '' or char_length(p_purpose) > 128 then
    raise exception 'Disclosure purpose must contain 1 to 128 characters' using errcode = '22023';
  end if;
  if p_disclosed is null then
    raise exception 'Disclosure must state whether data was sent' using errcode = '22023';
  end if;

  -- The filter revision must belong to the same tenant. The composite foreign key enforces this
  -- too; checking first turns a constraint violation into a named error for the caller.
  if p_filter_rule_id is not null and not exists (
    select 1 from public.filter_rules
    where user_id = p_user_id and id = p_filter_rule_id
  ) then
    raise exception 'Disclosure filter revision is unavailable' using errcode = 'P0002';
  end if;

  insert into public.ai_disclosures (
    user_id,
    source_item_id,
    filter_rule_id,
    provider,
    model,
    purpose,
    decision,
    disclosed,
    disclosed_fields,
    redactions,
    confidence,
    rationale,
    failure_reason,
    endpoint_host
  ) values (
    p_user_id,
    p_source_item_id,
    p_filter_rule_id,
    'openai',
    btrim(p_model),
    btrim(p_purpose),
    p_decision,
    p_disclosed,
    coalesce(p_disclosed_fields, '{}'::text[]),
    coalesce(p_redactions, '[]'::jsonb),
    p_confidence,
    p_rationale,
    p_failure_reason,
    nullif(btrim(coalesce(p_endpoint_host, '')), '')
  ) returning id into disclosure_id;

  -- Metadata only: counts and fixed enum values, never a field value, prompt, or rationale.
  insert into public.audit_log (
    user_id, actor_type, action, target_type, target_id, metadata
  ) values (
    p_user_id,
    'system',
    'filter.semantic_evaluated',
    'ai_disclosure',
    disclosure_id::text,
    jsonb_build_object(
      'provider', 'openai',
      'decision', p_decision,
      'disclosed', p_disclosed,
      'disclosedFieldCount', coalesce(array_length(p_disclosed_fields, 1), 0),
      'redactionCount', coalesce(jsonb_array_length(p_redactions), 0),
      'failureReason', p_failure_reason,
      'endpointHost', nullif(btrim(coalesce(p_endpoint_host, '')), '')
    )
  );

  return disclosure_id;
end;
$$;

revoke all on function public.record_semantic_disclosure_v1(
  uuid, uuid, uuid, text, text, text, boolean, text[], jsonb, text, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.record_semantic_disclosure_v1(
  uuid, uuid, uuid, text, text, text, boolean, text[], jsonb, text, numeric, text, text
) to service_role;

comment on column public.ai_disclosures.decision is
  'Relay''s decision after applying the clause confidence threshold, not the model''s label.';
comment on column public.ai_disclosures.disclosed is
  'Whether the request actually left the runtime. False rows record an attempt that sent nothing.';
comment on column public.ai_disclosures.confidence is
  'Model-reported certainty. Null when no usable answer was received.';
comment on column public.ai_disclosures.failure_reason is
  'Fixed reason a semantic evaluation produced no usable answer. Always paired with undecided.';
comment on column public.ai_disclosures.redactions is
  'Metadata-only redaction summary: field, class, and count. Never a removed value.';
comment on column public.ai_disclosures.endpoint_host is
  'Host the request was sent to. Present whenever anything actually left the runtime.';
