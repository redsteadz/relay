---
status: accepted
owner: architecture
last_verified: 2026-08-25
---

# Data Flow

```text
source -> authenticated ingress -> canonical envelope -> envelope encryption -> Queue
      -> tenant coordinator -> decrypt in memory -> durable encrypted source record
      -> source identity dedupe -> content fingerprint dedupe
      -> normalization -> categorization -> event extraction
      -> deterministic filter -> optional redacted semantic decision
      -> action proposal -> approval/automatic policy -> Workflow -> provider
```

## Delivery Semantics

Cloudflare Queues are at-least-once. Every stage can repeat after timeout or deployment. Source
identity uses provider kind, source account, and external ID. Content fingerprints catch equivalent
payloads with different delivery IDs. Supabase unique constraints are final durable arbitration;
Durable Objects reduce concurrent contention.

Queue and dead-letter payloads contain ciphertext, wrapped data key, nonces, key version, tenant ID,
and envelope ID, never raw source bodies. Coordinator acknowledges only after Supabase persistence.
Persisted encrypted rows also carry their owning Cloudflare environment so separate KEKs remain
isolated when a temporary backend is shared.
Explicit local development mode may use Durable Object storage instead, with seven-day alarms.
Producers reject encrypted messages above Relay's conservative 120 KB serialized cap under
[Cloudflare's 128 KB Queue limit](https://developers.cloudflare.com/queues/platform/limits/).
Consumers validate encrypted metadata before dispatch. Malformed bodies are dropped rather than
copied into the dead-letter queue, because an invalid body cannot be trusted to contain ciphertext.

## Local End-To-End Harness

`pnpm e2e:local` resets a local Supabase stack, starts local API and Wrangler processes, and sends the
shared synthetic mobile fixture through the complete encrypted ingress path. The harness verifies
encrypted Supabase persistence, source-identity and fingerprint deduplication, acknowledgement after
durable persistence, dead-letter metadata delivery, and controlled seven-day retention cleanup. It
accepts only a loopback Supabase URL and creates no remote Cloudflare or Supabase resources.

The `e2e` Wrangler environment exists only for `wrangler dev --local`. Result markers contain status
and key version only and remain in temporary local Durable Object storage. Controlled retention time
is honored only when `RELAY_E2E_MODE=true`, a valid explicit timestamp is present, and Supabase uses
an HTTP loopback URL.

Provider delivery uses Relay action UUID as idempotency identity. Nextcloud Budget accepts it
directly. Webhooks transmit it for receiver dedupe. Google Tasks needs a reconciliation marker
because Tasks insert does not provide equivalent idempotency semantics; implementation must search
or reconcile before an ambiguous retry.

## Failure Behavior

Invalid input is rejected before Queue publication. Transient internal failures retry. Exhausted
messages enter dead-letter processing with metadata and encrypted references only. Uncertain
classification remains visible in inbox; it must not silently become an external effect.

Related: [action model](action-model.md), [privacy lifecycle](../security/privacy.md).
