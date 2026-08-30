---
status: accepted
owner: integrations
last_verified: 2026-08-30
sources:
  - https://platform.openai.com/docs/api-reference/models/list
  - https://platform.openai.com/docs/api-reference/chat/create
  - https://platform.openai.com/docs/guides/structured-outputs
  - https://platform.openai.com/docs/guides/error-codes/api-errors
---

# OpenAI (BYOK)

Each user supplies their own OpenAI API key; Relay never provisions or shares one. The key is
validated against `GET /v1/models` — status only, the response body is discarded and never logged
or stored — then envelope-encrypted with `@relay/crypto` and persisted in the shared `connections`
table (`provider = 'openai'`) alongside every other connector credential.

`apps/api` owns the lifecycle at `/api/connectors/openai`:

- `POST` validates and stores a new key. Rejects (`409`) if one is already configured; use `PATCH`
  to rotate instead.
- `PATCH` validates a replacement key and re-encrypts in place, keeping the same connection id and
  therefore the same AAD-bound encryption context. `404` if nothing is configured yet.
- `DELETE` deletes the stored credential outright (matching the Gmail connector's disconnect
  behavior) and disables any enabled filter rule whose plan has a `semantic` clause, since those
  rules can no longer be evaluated without a live key.
- `GET` returns only `{ provider, configured, lastValidatedAt? }`. It never reads or returns the
  ciphertext, wrapped key, or nonce columns, so mobile only ever sees configuration metadata.

Validation always happens server-side against the live key at submission/rotation time; Relay does
not currently run a periodic background re-validation of stored keys (tracked as future work, see
ADR-0003).

## Semantic Clause Evaluation

`apps/pipeline` is the only runtime that calls the model, matching the boundary that keeps provider
calls out of `apps/api`. It selects the tenant's single active `openai` connection with the service
role, decrypts the key in memory under the connection's own AAD context, and discards it with the
request. More than one active row for a tenant is ambiguous consent, so evaluation fails closed
rather than choosing one.

Requests go to `POST /v1/chat/completions` on a pinned model (`gpt-4.1-mini`) with `temperature` 0,
a 200-token completion cap, a 15-second deadline, a 32 KB bounded response read, and no tools. The
key travels only as a bearer header. Responses use structured outputs with `strict` set, so the
model can return exactly `decision`, `confidence`, and `rationale`.

Provider conditions map to a fixed reason and always resolve the filter to `undecided`:
`credential-revoked` for 401 and 403, `quota-exhausted` for a 429 whose `error.code` is
`insufficient_quota`, `rate-limited` for any other 429, `timed-out`, `response-too-large`,
`invalid-response`, and `unavailable`. Only that reason string crosses the boundary; no provider
message text, body, or header is retained, logged, or surfaced.

The full minimization, redaction, delimiting, and disclosure-record rules live with the
[filter model](../architecture/filter-model.md); this page covers only the provider mechanics.

### Known follow-up

Relay does not deduplicate evaluations across Queue redelivery. A redelivered item with the same
semantic clause is evaluated again, which means a second request to OpenAI and a second disclosure
row. Recording both is deliberate -- the history must not undercount what was sent -- but suppressing
the repeat evaluation belongs to the processing path that calls the evaluator and is not yet built.

## Known follow-up

The shared `connections` table's row-level security still grants an authenticated user direct
`select` on their own full row (ciphertext, wrapped key, and nonce columns included) if a client
queries Supabase directly instead of going through `apps/api`. No current mobile code path does
this for `connections`, and this predates the OpenAI connector (it also covers Gmail), so narrowing
that policy is left as separate, connector-agnostic hardening work rather than folded into this
change.

Related: [privacy and data lifecycle](../security/privacy.md),
[ADR-0003: deterministic filters before BYOK AI](../decisions/0003-deterministic-before-ai.md).
