-- Quiet rules need not name an application.
--
-- `202610050001` required a deterministic plan, no semantic clause, and an explicit
-- `source.applicationId` predicate before a rule could act on a notification -- #38's first
-- acceptance criterion. ADR-0019 lifted the semantic restriction and ADR-0020 lifted the other two.
--
-- This is a separate migration rather than an edit to that one because `202610050001` is already
-- applied on the shared development project. Supabase records a migration as applied by version, so
-- an edit to an applied file never reaches a database that already ran it: local would have the new
-- routine and every deployed environment the old one, with nothing reporting the divergence.
--
-- See docs/decisions/0020-unscoped-quiet-rules.md.

-- The reasoning for the original gate did not survive being checked. It was that a rule with no
-- literal predicate would hand an unbounded stream of notifications to a model, which ADR-0003
-- exists to prevent -- but `evaluateFilterPlan` skips the deterministic branch entirely when there
-- is none and returns `undecided` whenever a semantic clause exists, so a purely descriptive rule
-- has been producing a model call per capture on the *filing* path since semantic filing shipped.
-- The cost argument describes both paths and distinguishes neither. The capture allowlist, not the
-- predicate, is what bounds the reach: the device returns before evaluating a notification it was
-- not allowed to capture.
--
-- What is still refused is a plan with neither part. It decides nothing and would act on
-- everything. `filter_rules.plan` is a bare `jsonb not null` with no shape constraint, so this is
-- the only check standing between such a row and an authorization -- not a second line behind one.
create or replace function public.dismissible_filter_rule(p_filter_rule_id uuid)
returns public.filter_rules
language plpgsql
security definer
set search_path = ''
as $$
declare
  rule public.filter_rules;
  tenant uuid := (select auth.uid());
begin
  if tenant is null then
    raise exception 'Notification dismissal requires an authenticated tenant' using errcode = '42501';
  end if;

  select * into rule
  from public.filter_rules
  where id = p_filter_rule_id and user_id = tenant;
  if rule.id is null then
    raise exception 'Filter rule is unavailable' using errcode = 'P0002';
  end if;

  if not (rule.plan ? 'deterministic') and not (rule.plan ? 'semantic') then
    raise exception 'Acting on a notification needs something to decide with' using errcode = '22023';
  end if;

  return rule;
end;
$$;

revoke all on function public.dismissible_filter_rule(uuid) from public, anon, authenticated;

-- Nothing calls it now. Dropped rather than left behind, so the next person reading the schema does
-- not take an unused predicate walker for a live safeguard. `if exists` because a database created
-- after ADR-0020 never had it.
drop function if exists public.filter_expression_binds_application(jsonb, integer);
