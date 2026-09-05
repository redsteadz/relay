-- Device-local classification.
--
-- `classifications` has never had a writer. The inbox reads it on every load and always receives an
-- empty set, so grouping falls back to whether a date fact happened to be derived and effectively
-- every capture is filed quietly. This migration gives the table a writer that is the user's own
-- device.
--
-- The device is the right place for this decision: `evaluateFilterPlan` is pure and already runs in
-- the app for the rule editor's live preview, the app already reads every table the evaluation needs
-- under row-level security, and deciding locally removes a round trip from the moment a capture is
-- categorised. See ADR-0014.
--
-- Trust is bounded rather than assumed. A client can only ever author a row marked as its own, and
-- `origin` is what any future action dispatch must check before letting a category gate an
-- irreversible provider effect.

alter table public.classifications
add column origin text not null default 'server' check (origin in ('server', 'device')),
add column filter_rule_id uuid,
add column superseded_at timestamptz,
-- A device evaluates deterministic predicates only. It never holds the tenant's model credential,
-- so a semantic claim from a device would be a claim it could not have made.
add constraint classifications_device_is_deterministic
  check (origin <> 'device' or method = 'deterministic'),
add constraint classifications_filter_rule_fk
  foreign key (user_id, filter_rule_id) references public.filter_rules(user_id, id)
  on delete set null (filter_rule_id);

comment on column public.classifications.origin is
  'Who decided this classification. A device-authored row must never gate a provider effect.';
comment on column public.classifications.filter_rule_id is
  'The exact rule revision that filed the capture. Revisions are immutable, so this is permanent provenance.';
comment on column public.classifications.superseded_at is
  'Set when a later classification replaced this one. Null marks the current row.';

-- One current classification per capture. Re-filing supersedes rather than replacing, so the reason
-- an item changed category stays readable, and a repeated pass cannot accumulate duplicate rows.
create unique index classifications_current_per_item_idx
  on public.classifications (user_id, source_item_id)
  where superseded_at is null;

-- The initial schema granted blanket DML to `authenticated` and relied on the absence of a
-- row-level policy to block writes. Adding any write path without this revoke would open direct
-- inserts alongside the routine below, and a client could then choose its own `origin`.
revoke insert, update, delete on public.classifications from authenticated;

/**
 * Records one device-authored classification.
 *
 * Ownership comes from `auth.uid()` and is never a parameter, matching `register_device`. The
 * routine fixes `origin`, `method` and `confidence` rather than accepting them: the device asserts
 * a deterministic boolean outcome, so a caller-supplied confidence gradient would be fabricated
 * precision and a caller-supplied origin would defeat the point of recording one.
 *
 * A capture already classified by the server is returned untouched. A device may refine its own
 * earlier answer, but it may not overwrite one made where the raw body was readable.
 */
create function public.record_device_classification_v1(
  p_source_item_id uuid,
  p_category_id uuid default null,
  p_filter_rule_id uuid default null,
  p_rationale text default null
)
returns public.classifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  current_row public.classifications;
  recorded public.classifications;
begin
  if owner_id is null then
    raise exception 'Classification requires an authenticated tenant' using errcode = '28000';
  end if;
  if p_source_item_id is null then
    raise exception 'Classification requires a capture' using errcode = '22023';
  end if;
  if p_rationale is not null and char_length(p_rationale) > 500 then
    raise exception 'Classification rationale must not exceed 500 characters' using errcode = '22023';
  end if;

  -- Composite foreign keys already confine every reference to one tenant. Checking first turns a
  -- guessed identifier into a stable "unavailable" instead of a raw constraint violation that would
  -- confirm the row exists for somebody else.
  if not exists (
    select 1 from public.source_items where user_id = owner_id and id = p_source_item_id
  ) then
    raise exception 'Capture is unavailable' using errcode = 'P0002';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories where user_id = owner_id and id = p_category_id
  ) then
    raise exception 'Category is unavailable' using errcode = 'P0002';
  end if;
  if p_filter_rule_id is not null and not exists (
    select 1 from public.filter_rules where user_id = owner_id and id = p_filter_rule_id
  ) then
    raise exception 'Filter rule is unavailable' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || p_source_item_id::text, 41));

  select * into current_row
  from public.classifications
  where user_id = owner_id and source_item_id = p_source_item_id and superseded_at is null
  for update;

  if current_row.id is not null and current_row.origin <> 'device' then
    return current_row;
  end if;

  if current_row.id is not null then
    update public.classifications
    set superseded_at = now()
    where id = current_row.id;
  end if;

  insert into public.classifications (
    user_id, source_item_id, category_id, method, confidence, rationale, origin, filter_rule_id
  ) values (
    owner_id, p_source_item_id, p_category_id, 'deterministic', 1.000, p_rationale,
    'device', p_filter_rule_id
  )
  returning * into recorded;

  return recorded;
end;
$$;

revoke all on function public.record_device_classification_v1(uuid, uuid, uuid, text)
from public, anon;
grant execute on function public.record_device_classification_v1(uuid, uuid, uuid, text)
to authenticated, service_role;

/**
 * Withdraws this device's own classification.
 *
 * Filing must be reversible by the same reasoning that produced it. When the rule that filed a
 * capture is disabled or edited so it no longer matches, the capture is no longer filed, and leaving
 * the old row standing would state something the rules no longer support -- the inbox would keep
 * showing a category no rule would produce.
 *
 * Withdrawal supersedes rather than deletes, so the record of what was believed, and when, survives.
 * A server classification is returned untouched: a device may withdraw only what a device decided.
 */
create function public.withdraw_device_classification_v1(p_source_item_id uuid)
returns public.classifications
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  current_row public.classifications;
begin
  if owner_id is null then
    raise exception 'Classification requires an authenticated tenant' using errcode = '28000';
  end if;
  if p_source_item_id is null then
    raise exception 'Classification requires a capture' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(owner_id::text || p_source_item_id::text, 41));

  select * into current_row
  from public.classifications
  where user_id = owner_id and source_item_id = p_source_item_id and superseded_at is null
  for update;

  if current_row.id is null or current_row.origin <> 'device' then
    return current_row;
  end if;

  update public.classifications
  set superseded_at = now()
  where id = current_row.id
  returning * into current_row;

  return current_row;
end;
$$;

revoke all on function public.withdraw_device_classification_v1(uuid) from public, anon;
grant execute on function public.withdraw_device_classification_v1(uuid) to authenticated, service_role;
