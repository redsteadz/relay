---
status: accepted
owner: architecture
last_verified: 2026-08-28
---

# Data Flow

```text
source -> authenticated ingress -> canonical envelope -> envelope encryption -> Queue
      -> tenant coordinator -> decrypt in memory -> durable encrypted source record
      -> source identity dedupe -> content fingerprint dedupe
      -> normalization -> categorization -> event extraction
      -> deterministic filter -> optional redacted semantic decision
      -> action proposal (provider dispatch remains disabled until issue #35)

Queue retry exhaustion -> dead-letter Queue -> ciphertext-only dead-letter ledger
operator recovery credential -> metadata inspection -> atomic replay claim -> original Queue
```

## Delivery Semantics

Cloudflare Queues are at-least-once. Every stage can repeat after timeout or deployment. Source
identity uses provider kind, source account, and external ID. Content fingerprints catch equivalent
payloads with different delivery IDs. One Durable Object instance per tenant explicitly serializes
decryption, deduplication, and persistence. Supabase unique constraints remain final durable
arbitration through `persist_encrypted_source_item_v2`; its atomic boolean result reports insert or
idempotent conflict without reflecting database details. Database conflicts do not populate candidate
Durable Object identity or fingerprint markers.

## Deduplication

Two independent layers guard against Cloudflare Queue's at-least-once redelivery, and either alone is
sufficient for correctness — the second exists because the first is fast, not because it is required:

- **Durable Object local cache** (`source:<identity>` / `fingerprint:<fingerprint>` keys in
  `DurableObjectStorage`). This is a fast path only. It is durable across a Durable Object eviction and
  restart, since `DurableObjectStorage`, unlike in-memory JS state, survives that; but a message that
  reaches the Supabase RPC and gets a `duplicate` result back deliberately does not populate it (see
  above), so it cannot be assumed complete after any retried or concurrent delivery.
- **`source_items` unique constraints** (`(user_id, id)`, `(user_id, source, source_account_id,
external_id)` with `nulls not distinct`, and `(user_id, content_fingerprint)`), enforced by Postgres
  through `persist_encrypted_source_item_v2`'s `insert ... on conflict do nothing`. This is final
  arbitration: even two deliveries that both miss the Durable Object local cache (a genuine race, or a
  cold cache right after a restart) still converge on exactly one row, because Postgres — not the
  Durable Object process — serializes the conflicting inserts. This is also what makes a lost HTTP
  response safe after a commit: the coordinator cannot tell "committed, response lost" apart from
  "never reached the database," so it always retries as if persistence failed; the retry reaches the
  same unique constraint and gets `duplicate` back instead of creating a second row.

Content fingerprint canonicalization (source kind, application ID, then normalized sender/subject/body
joined with the ASCII unit-separator control character `U+001F`, SHA-256 hex-encoded — `contentFingerprint` in
`packages/domain/src/index.ts`) is algorithm version 1
(`CONTENT_FINGERPRINT_ALGORITHM_VERSION` in `apps/pipeline/src/dedup.ts`). The persisted column is a
bare 64-character lowercase hex digest (`content_fingerprint text ... check (content_fingerprint ~
'^[0-9a-f]{64}$')`-equivalent validation lives in the RPC), so the version cannot be embedded in the
value itself; the constant is the canonical record of which rule produced it. Changing the
canonicalization is an algorithm version bump, not a formatting tweak, and needs an explicit migration
plan for already-persisted fingerprints (recompute-and-compare, or an accepted dedupe gap across the
boundary) rather than a silent behavior change.

Neither layer ever deletes a `source_items` row on a fingerprint or identity match — a conflict only
suppresses a _new_ insert. Cross-source content similarity is not a deletion trigger anywhere in this
codebase; the only automated deletion is the unrelated seven-day raw-payload retention purge
(`purge_expired_raw_payloads`, see [privacy lifecycle](../security/privacy.md)), which is time-based
and has no fingerprint or similarity input.

Queue and dead-letter payloads contain ciphertext, wrapped data key, nonces, key version, tenant ID,
envelope ID, recovery ID, original acceptance time, and original expiry, never raw source bodies.
Acceptance and expiry also live inside encrypted plaintext, so coordinator rejects modified Queue
metadata after decryption. Coordinator acknowledges only after Supabase persistence. Source rows use
original authenticated expiry rather than persistence time, so Queue delay cannot extend retention.
Persisted encrypted rows retain stable hosted KEK scope for rotation compatibility. Relay currently
has one hosted keyring; local E2E scope exists only in resettable local database.
Explicit local development mode may use Durable Object storage instead, with seven-day alarms.
Producers reject encrypted messages above Relay's conservative 120 KB serialized cap under
[Cloudflare's 128 KB Queue limit](https://developers.cloudflare.com/queues/platform/limits/).
Consumers validate encrypted metadata before dispatch. Malformed bodies are dropped rather than
copied into the dead-letter queue, because an invalid body cannot be trusted to contain ciphertext.
Hosted ingestion validates the KEK, HTTPS Supabase URL, and backend key before Queue publication.
Production rejects local Durable Object fallback even when its development flag is present.

Pipeline Analytics Engine points use only fixed metric names, numeric counts, and numeric latency in
milliseconds. Tenant IDs, envelope IDs, source metadata, ciphertext, URLs, errors, and plaintext are
not metric dimensions or values.

## Local End-To-End Harness

`pnpm e2e:local` resets a local Supabase stack, starts local API and Wrangler processes, and sends the
shared synthetic mobile fixture through the complete encrypted ingress path. The harness verifies
encrypted Supabase persistence, source-identity and fingerprint deduplication, acknowledgement after
durable persistence, cold database conflict outcomes, duplicate-cache safety, dead-letter metadata
delivery, operator inspection, exact encrypted replay, terminal replay cleanup, action-run absence,
and controlled seven-day retention cleanup. It
accepts only a loopback Supabase URL and creates no remote Cloudflare or Supabase resources.

The `wrangler.e2e.jsonc` config exists only for `wrangler dev --local`. Result markers contain status
and key version only and remain in temporary local Durable Object storage. Controlled retention time
is honored only when `RELAY_E2E_MODE=true`, a valid explicit timestamp is present, and Supabase uses
an HTTP loopback URL.

Provider delivery uses Relay action UUID as idempotency identity. Nextcloud Budget accepts it
directly. Webhooks transmit it for receiver dedupe. Google Tasks needs a reconciliation marker
because Tasks insert does not provide equivalent idempotency semantics; implementation must search
or reconcile before an ambiguous retry.

## Failure Behavior

Invalid input is rejected before Queue publication. Transient internal failures retry. Exhausted
messages enter production dead-letter processing. `dead_letter_items` stores exact encrypted Queue
components, fixed failure code, original identity/expiry, and replay state. Authenticated users have no
table or RPC access. Dedicated operator API returns metadata only; it has no decrypt operation.
Coordinator maps configuration, unavailable key version, invalid ciphertext/envelope, persistence,
tenant-conflict, and invalid-response failures to fixed codes without reflecting error text. Final
attempt republishes that metadata beside ciphertext to existing dead-letter Queue. If durable recovery
storage is unavailable, DLQ consumer parks exact message back onto same Queue with bounded delay until
original expiry.

Replay atomically claims one unexpired item with stable request UUID and republishes exact ciphertext,
source identity, encryption context, and original expiry. Queue completion records `succeeded` or
`duplicate`, destroys recoverable dead-letter encryption fields, and writes metadata-only audit rows.
An ambiguous Queue publication or failed replay retains same active request ID; only retry with that
ID can republish it. Repeated completion is idempotent. Terminal or expired rows cannot regain ciphertext. Source unique
constraints and coordinator dedupe remain final arbitration, and recovery cannot create action rows
while action dispatch is disabled. Uncertain classification remains visible in inbox; it must not
silently become an external effect.

Related: [action model](action-model.md), [privacy lifecycle](../security/privacy.md).
