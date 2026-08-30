---
status: accepted
owner: architecture
last_verified: 2026-08-30
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

## Deterministic Evaluation

`evaluateFilterPlan` in `packages/domain` decides a compiled plan against one item. It is pure: it
never calls a provider, never mutates the item, and never logs or returns a field value. Only field
names, operators, and positions leave the evaluator.

It returns the decision, the plan's `schemaVersion` and `compilerVersion`, and `matchedPredicates` --
every predicate that evaluated true, with its position in the expression such as `all[0].any[1]`. A
predicate under `not` can therefore appear while the decision is `no-match`; the list explains the
evaluation and does not by itself justify the decision.

### Tri-State Rules

| Situation                                                                 | Result                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------ |
| Deterministic expression fails                                            | `no-match`, and the semantic clause is never consulted |
| Deterministic passes, no semantic clause                                  | `match`                                                |
| Deterministic passes, semantic clause present                             | `undecided`                                            |
| Field absent, `null`, empty, or not a string, under a comparison operator | that predicate is **false**                            |
| Field absent, `null`, or empty, under `exists`                            | that predicate is **false**                            |

An absent field makes its predicate false rather than unknown. Treating absence as unknown would
promote items to `undecided` and send more content to OpenAI purely because a field was missing,
which contradicts [deterministic filters before BYOK AI](../decisions/0003-deterministic-before-ai.md).
`undecided` therefore arises only from a semantic clause.

One consequence is worth stating plainly: because absence is false, `not` over a comparison on an
absent field is true. `not (subject contains "x")` matches an item that has no subject at all. Use
`exists` to test presence explicitly when that distinction matters.

Comparisons normalize both sides with Unicode NFKC, trim, collapse internal whitespace, and
lowercase, so `café` and `café` compare equal. Money is the exception in spirit rather than
mechanism: `attributes.amount` is compared as its exact decimal string, so `10.50` does not equal
`10.5`, because the repository forbids routing money through a float to decide equality.

### Bounds

Evaluation re-checks the depth (8) and node (64) limits that `filterPlanSchema` already enforces, so
a plan built in memory without passing the schema cannot recurse without bound; exceeding either
raises `FilterEvaluationLimitError`, which carries the limit name and no field values. Each field is
read and normalized at most once per evaluation, so a plan holding the maximum number of predicates
over `body` normalizes a megabyte-sized body once rather than once per predicate.

## Semantic Evaluation

A plan that passes deterministically and carries a semantic clause is `undecided` until the clause
is resolved through the user's own OpenAI key. `evaluateFilterWithSemantics` in `apps/pipeline`
runs the deterministic evaluator first and only then loads a credential, so a plan the user already
excluded is never disclosed in order to discover that it was excluded.

### Minimization

`minimizeSemanticDisclosure` in `packages/domain` is pure and builds the entire payload. It reads
only the clause's own `allowedFields`, so a clause about a subject cannot pull a body along with it,
and it emits fields in the contract's canonical order rather than the order the intent happened to
mention them, so two plans disclosing the same fields produce identical records.

Each value is sanitized, redacted, and bounded, in that order:

| Step     | Rule                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Sanitize | Control and format characters are deleted; newline and tab survive as message layout                                                  |
| Redact   | Email addresses, URLs, API-key-shaped tokens, payment cards, phone numbers, and digit runs of six or more become `[redacted:<class>]` |
| Bound    | 2000 characters per field, 6000 across the whole disclosure                                                                           |

Redaction runs before truncation on purpose. Cutting first could split a card number across the
boundary, leaving a fragment that no longer matches its pattern and therefore is never removed.

`attributes.amount` is the one exception to the digit rule: redacting it would strip the value an
amount clause exists to judge. It is disclosed verbatim only while it is provably an exact decimal
string, and redacted whole otherwise. A field that is absent, empty, or not a string is not
disclosed at all, exactly as the deterministic evaluator treats it.

The recorded `redactions` carry a field, a class, and a count. They never carry a removed value or
its position, and the database enforces that shape so the rule cannot drift.

### The Endpoint

Evaluation speaks one wire format -- chat completions with a bearer key -- against a configurable
OpenAI-compatible endpoint under
[ADR-0011](../decisions/0011-openai-compatible-semantic-endpoint.md). Base URL, model, and how much
of the answer shape the endpoint is asked to enforce are configuration, defaulting to OpenAI and
`gpt-4.1-mini`. A tenant override stored beside their key wins over the operator default, because a
key issued by a gateway is only valid at that gateway.

The base URL is validated before anything is sent: HTTPS only, no embedded credentials, no query or
fragment, and private, loopback, and link-local addresses refused, so a configurable URL is not an
SSRF primitive. Plain HTTP to loopback is allowed only in development, which is how a locally hosted
model is reached. An override that fails validation yields `endpoint-invalid` and sends nothing; it
never falls back to an endpoint the tenant did not choose.

### The Request

The system message holds a fixed instruction block that is byte-identical for every evaluation. It
is the only content with instruction authority. Both the user's question and the disclosed fields
travel as JSON values in the user message, under `question` and `untrustedSourceData`, so
`JSON.stringify` is the delimiter: a body containing quotes, braces, or a forged conversation turn
becomes one escaped string value and cannot continue as message structure.

Relay sends no tools. By default the response uses OpenAI structured outputs with `strict` set and
`additionalProperties` false, admitting exactly `decision`, `confidence`, and `rationale`. Endpoints
that implement only the older `json_object` mode, or none at all, can be configured accordingly --
that changes what the _provider_ enforces, never what Relay accepts, because every answer is parsed
through the same strict contract schema either way. A reply
that also names a provider, endpoint, credential, or operation is rejected by the provider schema
and rejected again by `semanticEvaluationSchema`, which is `.strict()` for the same reason. A reply
carrying a `tool_calls` array, a refusal, or a non-`stop` finish reason is not an answer and is
discarded rather than partially interpreted.

Tests prove the structural property rather than model behaviour: for every fixture in the
prompt-injection corpus the instruction block is unchanged, the user message parses back to exactly
two keys, and the injected text appears only as a string value inside `untrustedSourceData`.

### The Decision

The decision is Relay's, not the model's. An answer below the clause's `minimumConfidence` is
`undecided` whatever label it carried, and that applies to `no-match` as well as `match`: an
uncertain rejection is as unusable as an uncertain acceptance.

Every provider condition also yields `undecided`, so no failure can be mistaken for a match:

| Condition                                                      | Reason                  |
| -------------------------------------------------------------- | ----------------------- |
| No key configured, or a key that cannot unwrap                 | `credential-missing`    |
| 401 or 403 from the provider                                   | `credential-revoked`    |
| 429 with `insufficient_quota`                                  | `quota-exhausted`       |
| Any other 429                                                  | `rate-limited`          |
| Deadline exceeded                                              | `timed-out`             |
| Body over 32 KB                                                | `response-too-large`    |
| Unparseable, refused, or off-schema answer                     | `invalid-response`      |
| No allowlisted field held a value                              | `no-disclosable-fields` |
| Anything else, including more than one active key for a tenant | `unavailable`           |

Only the fixed reason string leaves the provider boundary. The 429 split reads the provider's
`error.code` and nothing else, so no provider message text is retained.

### The Record

`record_semantic_disclosure_v1` writes one `ai_disclosures` row and one metadata-only audit row in
the same transaction. The row holds provider, model, purpose, decision, disclosed field names,
redaction summary, confidence, rationale, and any failure reason -- never the prompt, the response,
or the source content.

`disclosed` separates an attempt that sent something from one that sent nothing. It is set before
the response is known, because a request that failed in flight may still have been received; an
attempt that never reached the provider records no fields and no redactions, and the database
rejects a row that claims otherwise. Disclosures are immutable once written and are removed only by
the whole-account cascade.

Queue redelivery re-evaluates and therefore re-discloses, and each attempt is a separate row.
Collapsing them would make the history claim fewer disclosures than actually happened. Avoiding the
repeat evaluation belongs to the processing path that calls the evaluator, not to the record.

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
