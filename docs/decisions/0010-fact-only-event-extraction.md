---
status: accepted
date: 2026-08-30
owners: maintainers
---

# ADR-0010: Fact-Only Event Extraction Before Categorization

## Context

Accepted data flow previously placed categorization before event extraction, but category management
does not classify source items at runtime. Waiting for a future categorizer would leave normalized
facts without task, reminder, calendar-event, or concise fact records. Using source subject/body text
or user-managed categories directly would also make extraction less private and less deterministic.

## Decision

Extractor version 1 runs after typed-fact persistence and before future categorization. It consumes
only a runtime-validated `SourceFactSet`; provider kind, category, subject, and raw body cannot select
event behavior.

Certain start facts produce calendar events, certain due facts produce reminders, order/tracking
references without due time produce tasks, and all other inputs produce concise facts. Missing evidence
does not guess a stronger kind. Uncertain temporal evidence remains explicit and contains no inferred
instant or time zone.

Resolved times use exact canonical UTC text from normalized facts. Every event carries source,
normalizer, extractor, ordinal, confidence, review state, and fact-ordinal/field-path provenance.
Persistence is append-only by normalizer and extractor version. Exact retries are duplicates; changed
output under one version is an integrity failure.

## Consequences

Event extraction can ship independently of categorization and remains provider-neutral. Version 1 is
intentionally conservative: generic source content becomes a fact rather than guessed task/reminder
semantics. A future extractor may use newly normalized evidence or a reviewed category input only
under a new extractor version and updated decision.

Legacy event rows remain distinguishable because they have no extractor metadata. Exact retries of
legacy fact-only Durable Object bindings may backfill current events before upgrading markers.

This decision governs the event extractor, not the fact normalizer.
[ADR-0013](0013-text-derived-facts.md) later made subject and body evidence for _facts_, one stage
earlier. The constraint stated here is unchanged: extraction still consumes only a validated
`SourceFactSet`, and subject, body, provider kind, and category still cannot select event behavior.

Related: [data flow](../architecture/data-flow.md),
[privacy lifecycle](../security/privacy.md).
