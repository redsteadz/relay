-- Custom category management (issue #24).
--
-- Extends the existing `public.categories` table so tenants can create, rename, reorder, quiet, and
-- archive their own categories while system categories stay stable and historical classifications
-- survive.
--
-- Name normalization (canonical definition, mirrored by `normalizeCategoryName` in
-- `packages/domain`): Unicode NFKC, trim, collapse internal whitespace runs to one space, lowercase.
-- `normalized_name` is a stored generated column so uniqueness cannot drift from the rule, and every
-- component of the expression is immutable.

alter table public.categories
  add column sort_order integer not null default 0,
  add column archived_at timestamptz,
  add column normalized_name text generated always as (
    lower(regexp_replace(btrim(normalize(name, NFKC)), '\s+', ' ', 'g'))
  ) stored;

alter table public.categories
  add constraint categories_name_not_blank check (btrim(name) <> ''),
  add constraint categories_name_length check (char_length(name) <= 60),
  add constraint categories_sort_order_non_negative check (sort_order >= 0),
  add constraint categories_system_not_archived check (not (is_system and archived_at is not null));

-- Tenant-unique names under the documented normalization. Slug uniqueness already exists and stays
-- the stable machine identity; this adds human-name uniqueness so a tenant cannot hold "Work" and
-- "  work  " at once.
create unique index categories_user_normalized_name_key
  on public.categories (user_id, normalized_name);

-- Ordering and archive lookups stay tenant-scoped.
create index categories_user_active_order_idx
  on public.categories (user_id, sort_order, id)
  where archived_at is null;

create function public.enforce_category_invariants()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Only the signup seeder (a `security definer` function, so `current_role` is its owner rather
    -- than `authenticated`) may introduce system categories.
    if new.is_system and current_role = 'authenticated' then
      raise exception 'System categories cannot be created by users' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'Category tenant cannot change' using errcode = '42501';
    end if;
    if new.is_system is distinct from old.is_system then
      raise exception 'Category system flag is immutable' using errcode = '42501';
    end if;
    if old.is_system and new.slug is distinct from old.slug then
      raise exception 'System category slug is immutable' using errcode = '42501';
    end if;
    return new;
  end if;

  -- DELETE
  if old.is_system then
    raise exception 'System category cannot be deleted' using errcode = '42501';
  end if;
  -- Archiving, not deletion, is the supported way to retire a category that already explains
  -- historical classifications. `classifications.category_id` is `on delete set null`, so allowing
  -- the delete would silently erase that provenance.
  if exists (
    select 1
    from public.classifications c
    where c.user_id = old.user_id
      and c.category_id = old.id
  ) then
    raise exception 'Category with existing classifications must be archived, not deleted'
      using errcode = '23503';
  end if;
  return old;
end;
$$;

revoke all on function public.enforce_category_invariants() from public, anon, authenticated;

create trigger categories_enforce_invariants
before insert or update or delete on public.categories
for each row execute function public.enforce_category_invariants();

comment on column public.categories.sort_order is
  'Tenant-controlled display order. Not unique; ties break by id.';
comment on column public.categories.archived_at is
  'Set to retire a custom category while preserving historical classifications. System categories cannot be archived.';
comment on column public.categories.normalized_name is
  'Generated: lower(collapse-whitespace(trim(NFKC(name)))). Enforces tenant-unique names.';
