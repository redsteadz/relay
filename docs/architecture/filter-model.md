---
status: accepted
owner: architecture
last_verified: 2026-08-24
---

# Filter Model

A user states intent in natural language. Relay compiles it into a versioned `FilterPlan` containing
inspectable deterministic predicates and, only when necessary, an explicit semantic question.

Evaluation has three results: `match`, `no-match`, and `undecided`. A failed deterministic
predicate is `no-match`. A passing plan without semantic clause is `match`. A passing plan with a
semantic clause is `undecided` until minimized fields are evaluated through the user's OpenAI key.

Every semantic clause declares allowed fields and minimum confidence. Relay records model,
disclosed fields, redactions, purpose, confidence, and rationale. Low confidence remains
undecided and cannot trigger automatic effects.

Filter versions are immutable once used. Editing creates a new version so audit records can explain
historical decisions.

Related: [AI decision ADR](../decisions/0003-deterministic-before-ai.md),
[privacy model](../security/privacy.md).
