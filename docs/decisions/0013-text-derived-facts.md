---
status: accepted
date: 2026-09-02
owners: maintainers
---

# ADR-0013: Text-Derived Facts In Normalizer Version 2

## Context

Normalizer version 1 built facts only from `attributes`. That was workable while device capture was
the only source, because a notification adapter can attach `amount`, `merchant`, and `dates` it
already parsed on the device. It does not survive contact with Gmail.

A Gmail envelope carries transport metadata and nothing else: `gmailBodyBytes`, `gmailLabelIds`,
`gmailThreadId`, and the truncation flags. None of the fields the normalizer reads are present. Every
Gmail capture therefore produced exactly one sender fact plus the envelope's own occurred and
captured instants, which the extractor turned into an untyped `fact` event with no resolved time.
In the inbox that is the `quiet` group, always. An invoice due Friday, a delivery arriving Monday,
and a newsletter were indistinguishable.

Relay exists to make a notification list quiet by sorting what matters from what does not. A router
that cannot tell those three apart does not do the one thing it is for. The limitation was not a
privacy protection either: `ingressEnvelopeSchema` has always carried `subject` and `body`, the
pipeline has always decrypted them in memory to compute a content fingerprint, and
`source_items.raw_expires_at` has always discarded the encrypted copy after seven days. The text was
already received, already protected, and simply never read for evidence.

## Decision

Normalizer version 2 derives facts from the envelope's own `subject` and `body`, in addition to
`attributes`. Extraction covers dates, amounts with their currency, and references.

Attributes win. Text is consulted only where the envelope declared nothing for that kind, and for
dates only where it declared nothing for that _role_, so a source that states its own amount never
has that value re-litigated against its prose. A capture that already carries structured detail
normalizes exactly as it did under version 1.

Extraction never guesses. A pattern resolves to exactly one canonical value or yields nothing:

- An ambiguous numeric date is not read at all. `03/04/2026` is two different days by locale.
- A date with no cue word is not read, because filing it as `occurred` would contradict the
  envelope's own timestamp and make every dated message uncertain.
- A bare number is never money. An amount needs an explicit unit.
- A three-letter token is a currency only if it is on the ISO 4217 allowlist, so `THE 100` and
  `VAT 20` are not amounts.
- `$` yields an amount but never a currency, because it is USD, CAD, AUD, and more.
- A reference must name its own kind; an arbitrary alphanumeric token is not an order number.

Two different values read from one field remain `contradictory`, exactly as conflicting attributes
already did, so the honest outcome of an unclear message is review rather than a confident wrong
answer.

Fact provenance may now name `subject` and `body`, and carries the character span a value was read
from. Provenance still records a field and offsets, never a value, so the record discloses no
message content that the fact itself does not already contain.

ADR-0010 is unchanged. Event extraction still consumes only a runtime-validated `SourceFactSet`;
subject, body, provider kind, and category still cannot select event behavior. Text became evidence
for _facts_, one stage earlier, which is why the extractor needed no new input to start producing
reminders and calendar events for mail.

Bounds are explicit. Each field is scanned to a 20,000-character prefix and each kind yields at most
eight candidates, so a megabyte body cannot dominate a tenant's processing budget.

## Consequences

Gmail captures now reach every inbox group. An invoice with a stated due date becomes a reminder in
`actionable`; a message with two different totals becomes `needs-review`; a newsletter stays
`quiet` because nothing matched.

The version bump changes every fact-set fingerprint, so
`source_items.fact_set_normalizer_version` records which normalizer produced a stored digest, and
the integrity check compares digests only within one version. Differing output under one version is
still an integrity failure. Differing output across a bump is the expected result of a deploy: the
stored row stands and the retry reports as a duplicate rather than dead-lettering. Existing rows are
backfilled to version 1.

Facts already persisted under version 1 are not rewritten. Persistence remains append-only by
normalizer version, so an item captured before this change keeps its version 1 facts and does not
gain richer ones without an explicit reprocess.

Extraction is deliberately conservative and will under-read rather than over-read. Recall is the
open question, not precision; widening a pattern is a version 3 decision with its own evidence.

Related: [ADR-0010](0010-fact-only-event-extraction.md), [data flow](../architecture/data-flow.md),
[filter model](../architecture/filter-model.md), [privacy lifecycle](../security/privacy.md).
