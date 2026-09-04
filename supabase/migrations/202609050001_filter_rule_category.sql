-- The category a rule files a matching capture into.
--
-- `category` was already a field a rule could match *on*, but nothing recorded where a match should
-- go. A rule could therefore decide match, no-match, or undecided and still have nowhere to put the
-- item, which is why classification could not be wired into ingest: the evaluator's answer had no
-- destination. This column is that destination.
--
-- Nullable on purpose. A rule that names no category still classifies -- the classification records
-- that a rule matched and how it decided -- and the inbox can say an item was filed without
-- claiming it landed in a category the reader never created.
--
-- `on delete set null` mirrors `classifications.category_id`: deleting a category must not delete
-- the rules that referenced it, because a rule's intent and version history outlive any one
-- category and silently dropping rules would remove a decision a person made.

alter table public.filter_rules
add column category_id uuid,
add constraint filter_rules_category_fk
  foreign key (user_id, category_id) references public.categories(user_id, id)
  on delete set null (category_id);

comment on column public.filter_rules.category_id is
  'Category a matching capture is filed into. Null files the capture without naming a category.';

-- Rules are read per capture during ingest, always as the newest enabled version of each series.
create index filter_rules_active_series_idx
  on public.filter_rules (user_id, series_id, version desc)
  where enabled;
