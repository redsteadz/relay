-- Server-authored classification.
--
-- `classifications` gained a device writer in 202609050003 and, with it, the rule that a capture has
-- exactly one current row: `classifications_current_per_item_idx` is unique on
-- `(user_id, source_item_id) where superseded_at is null`. The pipeline was never moved onto that
-- rule. It still writes with a blind `POST /rest/v1/classifications`, which sets no `superseded_at`
-- and so produces a second current row for the same capture -- a unique violation. The practical
-- effect is that the server can classify a capture exactly once, and can never re-file one.
--
-- The same insert also leaves `filter_rule_id` null, so a server-filed capture cannot say which rule
-- revision filed it, even though the column exists for that purpose and the device path sets it. The
-- rationale string names the rule instead, which is prose rather than provenance.
--
-- ADR-0014 recorded this as a consequence to resolve: "a pipeline writer must supersede rather than
-- blind-insert". This routine is that writer, and it is deliberately the mirror of
-- `record_device_classification_v1` rather than a second design.
--
-- Two differences from the device routine, both intentional:
--
--   * Ownership is a parameter. The pipeline calls with the service role and has no `auth.uid()`, so
--     the tenant cannot be derived the way the device routine derives it. That makes the grant the
--     load-bearing control: a caller who could reach this with a chosen `p_user_id` could author a
--     row for any tenant, so execute is granted to `service_role` alone and revoked from
--     `authenticated` -- which the device routine can safely hold.
--   * Method, confidence and model are parameters. The server may reach a semantic answer, which is
--     a claim the device is structurally incapable of making, so fixing them the way the device
--     routine fixes them would discard the outcome the evaluator produced. They are validated
--     instead of trusted.
--
-- Precedence follows ADR-0014 in both directions: a device must not overrule the server, and the
-- server does overrule a device. The device answer is superseded rather than deleted, so the inbox
-- can still explain why a capture changed category.
--
-- Re-classifying existing captures when a rule changes is deliberately NOT part of this routine.
-- Nothing re-classifies today, and adding a backfill is a separate decision about cost and about
-- what a person expects to happen to captures they already saw filed. This routine makes such a
-- backfill possible, which it previously was not.

create function public.record_server_classification_v1(
  p_user_id uuid,
  p_source_item_id uuid,
  p_category_id uuid default null,
  p_filter_rule_id uuid default null,
  p_method text default 'deterministic',
  p_confidence numeric default 1.000,
  p_model text default null,
  p_rationale text default null
)
returns public.classifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.classifications;
  recorded public.classifications;
begin
  if p_user_id is null then
    raise exception 'Classification requires a tenant' using errcode = '22023';
  end if;
  if p_source_item_id is null then
    raise exception 'Classification requires a capture' using errcode = '22023';
  end if;
  -- 'manual' is a person's own correction and is not the pipeline's to assert.
  if p_method is null or p_method not in ('deterministic', 'semantic') then
    raise exception 'Server classification must be deterministic or semantic' using errcode = '22023';
  end if;
  if p_confidence is null or p_confidence < 0 or p_confidence > 1 then
    raise exception 'Classification confidence must fall between 0 and 1' using errcode = '22023';
  end if;
  if p_rationale is not null and char_length(p_rationale) > 500 then
    raise exception 'Classification rationale must not exceed 500 characters' using errcode = '22023';
  end if;

  -- Composite foreign keys already confine every reference to one tenant. Checking first turns a
  -- guessed identifier into a stable "unavailable" instead of a raw constraint violation that would
  -- confirm the row exists for somebody else.
  if not exists (
    select 1 from public.source_items where user_id = p_user_id and id = p_source_item_id
  ) then
    raise exception 'Capture is unavailable' using errcode = 'P0002';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories where user_id = p_user_id and id = p_category_id
  ) then
    raise exception 'Category is unavailable' using errcode = 'P0002';
  end if;
  if p_filter_rule_id is not null and not exists (
    select 1 from public.filter_rules where user_id = p_user_id and id = p_filter_rule_id
  ) then
    raise exception 'Filter rule is unavailable' using errcode = 'P0002';
  end if;

  -- The same lock key and salt as `record_device_classification_v1`, so a device pass and a queue
  -- redelivery serialize against each other rather than racing for the one current row.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || p_source_item_id::text, 41));

  select * into current_row
  from public.classifications
  where user_id = p_user_id and source_item_id = p_source_item_id and superseded_at is null
  for update;

  if current_row.id is not null then
    update public.classifications
    set superseded_at = now()
    where id = current_row.id;
  end if;

  insert into public.classifications (
    user_id, source_item_id, category_id, method, confidence, rationale, model, origin,
    filter_rule_id
  ) values (
    p_user_id, p_source_item_id, p_category_id, p_method, p_confidence, p_rationale, p_model,
    'server', p_filter_rule_id
  )
  returning * into recorded;

  return recorded;
end;
$$;

comment on function public.record_server_classification_v1(
  uuid, uuid, uuid, uuid, text, numeric, text, text
) is
  'Records the pipeline''s classification of a capture, superseding the current row. Service role only.';

-- The tenant is a parameter here, so the grant is what confines the routine to the pipeline. An
-- `authenticated` caller holding this could author a server-origin row -- the exact row
-- 202609070001 requires before a category may gate an irreversible provider effect.
revoke all on function public.record_server_classification_v1(
  uuid, uuid, uuid, uuid, text, numeric, text, text
) from public, anon, authenticated;
grant execute on function public.record_server_classification_v1(
  uuid, uuid, uuid, uuid, text, numeric, text, text
) to service_role;
