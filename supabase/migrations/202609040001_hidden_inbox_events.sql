-- A reader's decision to take an item out of their own inbox view.
--
-- This is deliberately not called a dismissal. Dismissing a *source notification* clears it from the
-- phone's notification shade, which the privacy invariants gate behind an explicit filter rule and a
-- completed dry-run period. Hiding an inbox row touches neither the device nor the source; it only
-- says a person is done looking at a derived item.
--
-- The record lives beside `relay_events` rather than as a column on it. Events are derived and
-- append-only by extractor version, so a re-derivation would either lose a person's choice or force
-- a user decision into a machine-owned row. A separate table keeps the choice durable across
-- re-extraction and keeps `relay_events` a pure projection of the pipeline's output.
--
-- Hiding is reversible by design, so the row is deleted to restore rather than flagged.

create table public.hidden_inbox_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  hidden_at timestamptz not null default now(),
  primary key (user_id, event_id),
  foreign key (user_id, event_id) references public.relay_events(user_id, id) on delete cascade
);

comment on table public.hidden_inbox_events is
  'Inbox rows a reader removed from their own view. Never affects the device notification or the source item.';

-- The inbox reads this for the signed-in tenant on every load, so the primary key alone would force
-- a scan per read once a tenant hides many items.
create index hidden_inbox_events_user_idx on public.hidden_inbox_events (user_id, hidden_at desc);

alter table public.hidden_inbox_events enable row level security;

create policy "users manage own hidden inbox events" on public.hidden_inbox_events
for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Created after the initial schema's blanket grant, so this table needs its own.
grant select, insert, delete on public.hidden_inbox_events to authenticated;
grant all on public.hidden_inbox_events to service_role;
