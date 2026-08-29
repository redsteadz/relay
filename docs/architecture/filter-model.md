---
status: accepted
owner: architecture
last_verified: 2026-08-29
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

## Categories

Every tenant is seeded with ten immutable system categories (`transaction`, `task`, `event`,
`reminder`, `delivery`, `travel`, `security`, `communication`, `promotion`, `other`). A system
category's `slug` and `is_system` flag cannot be changed, it cannot be archived, and it cannot be
deleted; `slug` stays the stable machine identity that filters and classifications refer to.
Tenants may additionally create, rename, reorder (`sort_order`), quiet (`quiet_by_default`), and
archive their own categories.

Category names are unique per tenant under one canonical normalization: Unicode NFKC, trim,
collapse internal whitespace runs to a single space, lowercase. The database stores this as the
`normalized_name` generated column and enforces uniqueness on it, so the rule cannot drift;
`normalizeCategoryName` in `packages/domain` mirrors it so a client can predict a collision before
writing. The database remains the authority.

Archiving, not deletion, retires a category that already explains history. `classifications`
references categories with `on delete set null`, so deleting one would erase that provenance; a
category with existing classifications therefore rejects deletion and must be archived, which
preserves every historical classification reference.

Related: [AI decision ADR](../decisions/0003-deterministic-before-ai.md),
[privacy model](../security/privacy.md).
