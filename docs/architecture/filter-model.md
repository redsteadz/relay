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

## Compilation

`POST /api/filters/compile` accepts only a name, user intent, optional enabled state, and optional
`seriesId` plus `expectedVersion` edit coordinates. The API authenticates the user, validates the
strict request, and forwards verified identity to Pipeline. Source content, provider, endpoint,
credential, and operation fields are rejected at both HTTP boundaries. Compilation never receives a
source item, so adversarial SMS, email, or notification text cannot alter saved user intent.

Compiler version 1 is deterministic and does not call an AI provider. Pipeline loads only the
tenant's active category names and slugs, then recognizes these bounded forms:

| Form                                                        | Result                   |
| ----------------------------------------------------------- | ------------------------ |
| `from gmail`, `from sms`, `from email`, `from notification` | `source.kind equals`     |
| `sent by VALUE`                                             | `sender equals`          |
| `FIELD exists`, `FIELD is present`                          | `exists` where supported |
| `FIELD is VALUE`, `equals`, `contains`, `starts with`       | matching typed predicate |
| `FIELD in A, B`, `FIELD is one of A, B`                     | bounded `in` predicate   |

Supported fields are source kind/application, sender, subject, body, category, currency, merchant,
and exact-decimal amount. Quoted values may contain `and`; otherwise `and` joins deterministic
predicates. Category values resolve only through the active category descriptors loaded by Pipeline.
Currency is canonical uppercase ISO-style text, and amount stays an exact decimal string.

Every response presents the full supported predicate/operator matrix and unsupported clauses.
Unsupported descriptive clauses become an explicit semantic question with minimum confidence and a
field allowlist inferred from only that clause. Action language receives
`action-intent-not-allowed`; it cannot populate provider, endpoint, credential, operation, or action
fields, and action-only text is omitted from the semantic question. Invalid typed values remain
visible as `invalid-value` rather than being guessed. Any future AI-assisted compilation requires a
separate decision and disclosure policy; it is not part of compiler version 1.

## Versioning

Filter revisions are immutable once persisted. A new filter receives a stable random `series_id`
and version 1. Editing supplies both `seriesId` and `expectedVersion`; a database advisory lock and
optimistic version check atomically append the next revision or return a conflict. Authenticated
clients have read-only RLS access to their own revision history. Only Pipeline's service-role RPC can
append a revision. Each append records compiler version, supported predicates, unsupported clauses,
and an audit event so historical decisions remain explainable.

One monotonic safety exception exists: the service-only OpenAI revocation RPC may change an enabled
semantic revision to disabled without changing any identity, intent, plan, or disclosure field.
Compilation persistence and credential revocation take the same per-tenant advisory lock. Revocation
disables semantic revisions and deletes the credential atomically; a semantic revision appended
without an active key persists disabled. Re-enabling or any user edit still requires a new revision.
Authenticated clients cannot delete OpenAI connection rows directly, and service role has no direct
filter write grants, so neither path can bypass these RPC invariants.

## Categories

Every tenant is seeded with ten immutable system categories (`transaction`, `task`, `event`,
`reminder`, `delivery`, `travel`, `security`, `communication`, `promotion`, `other`). A system
category's `slug` and `is_system` flag cannot be changed, it cannot be archived, and it cannot be
deleted directly; whole-account foreign-key cascade remains able to remove it. `slug` stays the
stable machine identity that filters and classifications refer to.
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
