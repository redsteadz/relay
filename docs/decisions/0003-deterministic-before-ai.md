---
status: accepted
date: 2026-08-24
owners: maintainers
---

# ADR-0003: Deterministic Filters Before BYOK AI

## Context

Users need abstract filters, but sending every source item to a model increases cost, disclosure,
latency, and prompt-injection exposure.

## Decision

Compile natural language into versioned deterministic predicates and explicit semantic clauses.
Run deterministic predicates first. Use encrypted user-provided OpenAI key only for undecidable
clauses, with field allowlists, redaction, strict structured output, confidence threshold, and
disclosure audit.

## Consequences

Some intentions cannot compile completely and remain visibly semantic. Low-confidence results do not
trigger automatic effects. AI provider expansion is deferred behind same boundary.

Related: [filter model](../architecture/filter-model.md), [privacy](../security/privacy.md).
