---
status: accepted
owner: integrations
last_verified: 2026-08-28
sources:
  - https://platform.openai.com/docs/api-reference/models/list
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

## Known follow-up

The shared `connections` table's row-level security still grants an authenticated user direct
`select` on their own full row (ciphertext, wrapped key, and nonce columns included) if a client
queries Supabase directly instead of going through `apps/api`. No current mobile code path does
this for `connections`, and this predates the OpenAI connector (it also covers Gmail), so narrowing
that policy is left as separate, connector-agnostic hardening work rather than folded into this
change.

Related: [privacy and data lifecycle](../security/privacy.md),
[ADR-0003: deterministic filters before BYOK AI](../decisions/0003-deterministic-before-ai.md).
