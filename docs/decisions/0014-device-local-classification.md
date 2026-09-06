---
status: accepted
date: 2026-09-05
owners: maintainers
---

# ADR-0014: Device-Local Classification

## Context

`public.classifications` has never had a writer. The inbox reads it on every load and always receives
an empty set, so grouping falls back to whether a date fact happened to be derived, and effectively
every capture is filed quietly. A chat message, a receipt with no due date, and a newsletter are
indistinguishable.

Everything needed to decide is already on the device. `evaluateFilterPlan` in `packages/domain` is
pure and runtime-neutral, and the app already runs it in Hermes for the rule editor's live preview.
The app already reads `filter_rules`, `categories`, `source_items`, `source_facts` and `relay_events`
directly under row-level security. Since `filter_rules.category_id` exists, a matching rule now has a
destination.

Deciding on the device removes a round trip between a capture arriving and being categorised, and
keeps the decision on hardware the user controls. The cost is that classification authority moves to
a client, which `docs/architecture/system.md` previously forbade outright.

## Decision

The device evaluates the tenant's enabled rules against a capture and records the result. The
database stores the decision; it does not make it.

Trust is bounded rather than assumed:

- `classifications.origin` records who decided. A client can only ever author a `device` row.
- Direct `insert`, `update` and `delete` on `classifications` are revoked from `authenticated`. The
  only write path is `record_device_classification_v1`, a `security definer` routine that derives
  ownership from `auth.uid()` and fixes `origin`, `method` and `confidence` rather than accepting
  them.
- A device refines its own earlier answer but never overwrites a `server` row. The routine returns
  the server's classification untouched.
- One current classification exists per capture, enforced by a partial unique index on
  `superseded_at is null`. Re-filing supersedes, so the reason an item moved stays readable.

The device decides deterministically only. It never holds the tenant's model credential, so a
semantic clause is reported as awaiting a model and files nothing — a database check constraint
refuses a `device` row that claims a `semantic` method.

Field availability is declared before evaluation rather than inferred. A capture Relay received
through Gmail keeps its body only in `raw_ciphertext`, encrypted to a key the device does not hold,
while a capture the device made itself keeps a local copy for thirty days. The evaluator cannot tell
an unreadable field from an absent one, and absence is false: under a negated predicate that would
produce a match the capture never earned. So a rule referencing a field this device cannot supply
stops the walk and is reported, rather than being skipped or guessed.

Gmail is still classified. The pipeline derives facts from subject **and** body server-side, so
amount, currency, merchant, dates and references from a Gmail body reach the device as
`source_facts` even though the body itself does not. Only a literal `body` predicate is undecidable
there.

## Consequences

- **A device-authored classification must never gate a provider effect.** Action dispatch must
  require `origin = 'server'`. Nothing dispatches on category today, so this cannot be enforced in
  code yet; it is recorded here and in `docs/architecture/action-model.md`, and a blocking issue
  names this ADR and the dispatch path.
- Filing happens when the inbox is opened. There is no background JavaScript runtime in the app, so a
  capture that arrives while the app is closed is filed on the next open.
- Two devices can file the same capture. Supersession plus the partial unique index makes that
  last-writer-wins with history intact.
- A modified client can write any category for its own captures. It is the user's own tenant, and
  category gates nothing today, which is what makes the trade acceptable for now — the `origin` rule
  above is what keeps it acceptable later.
- The pipeline may still classify. `origin` is what lets a server writer coexist with this one rather
  than the two fighting over the same row; a pipeline writer must supersede rather than blind-insert,
  or the partial unique index will refuse it.

## Supersedes

This supersedes the "Must not own: classification authority" clause for Expo mobile in
`docs/architecture/system.md`, which is amended in the same change. Mobile now owns device-local
deterministic classification, and must not own semantic classification, service credentials, or
classification that gates an irreversible provider effect.

It does **not** supersede [ADR-0002](0002-cloudflare-processing-boundary.md): no provider call and no
credential moves to the device.

It does **not** supersede [ADR-0003](0003-deterministic-before-ai.md). Deterministic-before-AI is
strengthened rather than bent — the device is structurally incapable of semantic evaluation, so
deterministic predicates are the only thing it can run.

## References

- [Filter model](../architecture/filter-model.md)
- [System boundaries](../architecture/system.md)
- [Privacy and data lifecycle](../security/privacy.md)
