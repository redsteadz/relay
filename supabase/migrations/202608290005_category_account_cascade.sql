-- Preserve system-category protection without blocking account deletion.
--
-- The category trigger runs at depth one for a direct category delete and at a nested depth when an
-- auth.users foreign-key cascade removes tenant data. Account deletion must be able to complete.

create or replace function public.enforce_category_invariants()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
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

  -- Direct deletion remains forbidden. A nested foreign-key cascade from auth.users is required to
  -- remove system categories during whole-account deletion.
  if old.is_system and pg_trigger_depth() = 1 then
    raise exception 'System category cannot be deleted' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.classifications c
    where c.user_id = old.user_id
      and c.category_id = old.id
  ) and pg_trigger_depth() = 1 then
    raise exception 'Category with existing classifications must be archived, not deleted'
      using errcode = '23503';
  end if;
  return old;
end;
$$;
