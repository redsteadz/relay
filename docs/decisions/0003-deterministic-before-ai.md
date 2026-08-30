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

Compilation itself is source-free and deterministic in compiler version 1. It receives user intent
and trusted active category descriptors, never source text, and does not call an AI provider. Any
future AI-assisted compiler requires a separate decision and disclosure policy. Filter plans cannot
select actions, providers, endpoints, operations, or credentials.

## Consequences

Some intentions cannot compile completely and remain visibly semantic. Low-confidence results do not
trigger automatic effects. AI provider expansion is deferred behind same boundary.

[ADR-0012](0012-openai-compatible-semantic-endpoint.md) refines the provider wording above: the
endpoint is configurable and OpenAI-compatible rather than OpenAI specifically. Every other
constraint in this decision -- deterministic first, field allowlists, redaction, strict output,
confidence threshold, disclosure audit -- is unchanged and applies wherever the request is sent.

Related: [filter model](../architecture/filter-model.md), [privacy](../security/privacy.md).
