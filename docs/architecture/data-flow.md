---
status: accepted
owner: architecture
last_verified: 2026-08-29
---

# Data Flow

```text
source -> authenticated ingress -> canonical envelope -> envelope encryption -> Queue
      -> tenant coordinator -> decrypt in memory -> source identity/content fingerprint dedupe
      -> provider-neutral normalization -> durable encrypted source record + typed facts
      -> categorization -> event extraction
      -> deterministic filter -> optional redacted semantic decision
      -> action proposal (provider dispatch remains disabled until issue #35)

Queue retry exhaustion -> dead-letter Queue -> ciphertext-only dead-letter ledger
operator recovery credential -> metadata inspection -> atomic replay claim -> original Queue
```

Gmail adds authenticated cursor stage before canonical ingress:

```text
Google Pub/Sub -> API JWT verification -> bounded/validated cursor -> private Pipeline binding
  -> exact active mailbox ownership -> gmail:<connection-id> Durable Object pending cursor
  -> encrypted credential decrypt in memory -> Gmail History/message retrieval
  -> deterministic bounded Gmail envelope -> provider-authenticated encrypted ingress -> Queue
```

API performs only authenticated OAuth callback protocol exchanges and mailbox-profile verification.
After connector creation, Pipeline exclusively owns watch, History, message, stop, token revocation,
ordering, retry, and reconciliation work.

## Delivery Semantics

Cloudflare Queues are at-least-once. Every stage can repeat after timeout or deployment. Source
identity uses provider kind, source account, and external ID. Content fingerprints catch equivalent
payloads with different delivery IDs. One Durable Object instance per tenant explicitly serializes
decryption, deduplication, and persistence. Supabase unique constraints remain final durable
arbitration through `persist_encrypted_source_item_v3`; its fixed result reports stored, duplicate,
fact-integrity conflict, or tenant conflict without reflecting database details.
Gmail source rows use connection-bound `persist_encrypted_source_item_v4`, which retains v3 conflict
semantics while requiring active matching Gmail `(user_id, connection_id)` and writing
`source_items.connection_id`. Non-Gmail ingress remains on v3 during rolling deployment.

Gmail Pub/Sub cursor acknowledgement has separate durable boundary. Pipeline resolves normalized
mailbox to exactly one active connection, or acknowledges one unexpired disconnect tombstone without
routing work. Unique active ownership takes precedence over an old tombstone after reconnect. Active routing then uses
`gmail:<connection-id>` Durable Object, which atomically stores
identity and highest pending decimal History ID before returning success. IDs remain strings and are
compared with `BigInt`, never `Number`. Alarm retries reload Supabase cursor and encrypted credential,
so eviction loses no correctness state. Durable continuation limits an alarm to one History page or
ten message fetch/publications, records successful message progress, removes seen/chunk/page markers as
each page drains, and keeps newer pushes separate
from immutable active start/target cursors. Changed message IDs are deduplicated; deterministic
envelope UUID makes lost Queue responses safe. Cursor compare-and-set RPC treats already-advanced value
as idempotent lost-response retry and otherwise requires expected predecessor. Cursor never advances
before all pages and message publications complete. First-watch in-flight and returned-baseline states
prevent crash recovery from repeating `watch` and guessing an initial cursor; ambiguous initialization
instead enters explicit resync-required state. Explicit rejected watch responses clear in-flight state
and retry, while response loss after possible success remains ambiguous. Canonical provider details live in
[Gmail integration](../integrations/gmail.md).

Deterministic malformed/over-limit Gmail messages become tenant-bound metadata-only terminal receipts
keyed by message-ID digest. Receipt commit is equivalent to Queue acceptance only for advancing that
specific message; transient provider/Queue failures remain retryable, and receipts expire after seven
days. Durable alarm retry metadata and
explicit bounded backoff continue after Cloudflare automatic alarm retries would end.

Gmail consent withdrawal follows same private boundary: authenticated API forwards tenant/connection
identity to mailbox Durable Object; Pipeline durably executes `users.stop`, Google token revocation,
and idempotent Supabase credential deletion in that order. Failure before stop or revoke completion
retains encrypted credential for retry. Permanent Supabase receipt arbitrates lost delete responses.
Active Gmail rows deny direct authenticated table deletion. Same-tenant completed receipt makes API
retries successful after row deletion. Mailbox-digest tombstone absorbs late provider notifications
through saved watch expiration plus configured Pub/Sub retention without routing work.

Account deletion uses same private Gmail boundary before local finalization, but with explicit
best-effort exception: API sends only authenticated tenant/connection UUID in bounded, idempotent
request; Pipeline alone may decrypt credential and perform stop/revoke/receipt ordering. Pipeline or
provider failure is counted and does not block local credential, tenant-row, and identity deletion.
API never directly handles Gmail credential or provider call, and no plaintext enters logs. Ordinary
standalone Gmail disconnect retains strict retry-until-provider-complete behavior above.

## Deduplication

Two independent layers guard against Cloudflare Queue's at-least-once redelivery, and either alone is
sufficient for correctness — the second exists because the first is fast, not because it is required:

- **Durable Object local cache** (`source:<identity>`, `fingerprint:<fingerprint>`,
  `fact-set-fingerprint:<source-id>`, and `source-binding:<source-id>` keys in
  `DurableObjectStorage`). Bound markers contain source ID, fact digest, source identity, and content
  fingerprint and survive Durable Object eviction/restart. Exact same-ID database retries may populate
  them after fact persistence converges; duplicates under another candidate ID do not. Legacy unbound
  markers never decide a result. One multi-key `put` atomically writes related records, as guaranteed by
  [Cloudflare Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#put).
- **`source_items` unique constraints** (`(user_id, id)`, `(user_id, source, source_account_id,
external_id)` with `nulls not distinct`, and `(user_id, content_fingerprint)`), enforced by Postgres
  through `persist_encrypted_source_item_v3`'s `insert ... on conflict do nothing`. This is final
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
codebase. Automated retention is time-based and has no fingerprint or similarity input:
`purge_expired_raw_payloads` destroys seven-day raw/dead-letter encryption fields and deletes expired
Gmail terminal receipts and disconnect tombstones (see [privacy lifecycle](../security/privacy.md)).

Queue and dead-letter payloads contain ciphertext, wrapped data key, nonces, key version, tenant ID,
envelope ID, recovery ID, original acceptance time, and original expiry, never raw source bodies.
Encrypted plaintext also authenticates trusted producer. `gmail-provider` is required exactly for
reserved Gmail source; generic device ingress cannot claim provider ownership. Producer-aware payloads
use schema version 2. Queue drain accepts legacy version 1 only for non-Gmail source and canonicalizes
its implied producer to `device`.
Normal runtime UUID contracts canonicalize valid input to lowercase before new encryption context
creation. Encrypted Queue wire UUIDs instead validate while preserving original casing because user and
envelope IDs are authenticated encryption context. Consumers route by canonical tenant ID, decrypt
with exact wire IDs, then use lowercase IDs for Durable Object keys and database persistence. When
wire AAD casing differs, coordinator re-encrypts same validated plaintext in memory under canonical
user/envelope AAD before durable source storage; lowercase-produced messages reuse original encrypted
value.
PostgreSQL fact validation compares nested source UUIDs semantically while retaining strict RFC UUID
syntax validation.
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

## Typed Fact Normalization

Normalizer version 1 consumes only canonical envelope fields and canonical `attributes` candidates;
source kind never selects extraction logic. It emits runtime-validated sender, date, amount, currency,
merchant, location, and reference facts. Date facts carry explicit roles. Amount values remain bounded
plain decimal strings and never pass through a JavaScript number. Currency accepts uppercase
three-letter codes without silently rewriting candidate content. Valid date candidates may include
`Z` or an explicit numeric offset and up to nine fractional digits; normalization resolves the instant
and persists exactly 30 characters in UTC (`YYYY-MM-DDTHH:mm:ss.fffffffffZ`). Fractions are
right-padded rather than passed through JavaScript millisecond precision. Equivalent offset/fraction
forms therefore agree before contradiction evaluation, while distinct sub-millisecond instants remain
distinct. Runtime and database checks both reject impossible calendar values, noncanonical persisted
offsets, and persisted precision other than nine digits.

Every fact carries source item ID, normalizer version, deterministic ordinal, certainty, and one or
more field paths. Provenance stores paths and optional offsets only, never source snippets. Root
`sender`, `occurredAt`, and `capturedAt` plus allowlisted `attributes.sender`, `attributes.dates`,
`attributes.amount`, `attributes.currency`, `attributes.merchant`, `attributes.location`, and
`attributes.reference` are eligible. Body and subject are not copied into facts. Invalid candidates
become `uncertain/invalid`; conflicting scalar candidates become `uncertain/contradictory`. Uncertain
facts omit candidate values, so normalization neither guesses nor persists rejected plaintext.

Normalizer output receives a distinct SHA-256 `fact_set_fingerprint` over the complete
runtime-validated `SourceFactSet` JSON in contract key order. This digest is separate from legacy
content dedupe because dates and fact attributes are intentionally absent from `content_fingerprint`.
`persist_encrypted_source_item_v3` atomically inserts encrypted source and fact digest. Same-ID retries
require exact source identity, content fingerprint, and fact digest; changed bindings or NULL
pre-migration digests fail as `fact-integrity-conflict` before facts can attach. Source-identity/content
duplicates under another ID remain normal duplicates, and cross-tenant IDs return fixed
`tenant-conflict` metadata.

Hosted persistence writes facts through `persist_source_facts` only after encrypted source
persistence. `(user_id, source_item_id, normalizer_version, ordinal)` is unique and tenant-bound to
`source_items`; fact persistence requires the same exact fact digest. A missing candidate source ID
returns normal dedupe only when source persistence already returned `duplicate`. Fact version/digest
conflicts and impossible stored/missing states fail closed as `fact_integrity_conflict`. Exact retries
return `duplicate`; different output under the same normalizer version fails closed. If either RPC
commits but its response is lost, retry converges through exact digest/idempotency checks. Queue
acknowledgement occurs only after both durable stages converge.

Durable Object markers bind source ID, source identity, content fingerprint, and fact digest. Legacy
unbound markers fall through to Postgres. Local mode atomically stores encrypted source, structured
facts, envelope-ID digest, and source binding; an exact binding is duplicate, any changed binding is an
integrity failure, and an existing local source without a complete binding fails closed. Database
duplicates under another source ID never receive candidate markers.

Pipeline Analytics Engine points use only fixed metric names, numeric counts, and numeric latency in
milliseconds. Tenant IDs, envelope IDs, source metadata, ciphertext, URLs, errors, and plaintext are
not metric dimensions or values.

Gmail callback/provider paths emit no dynamic logs or metric dimensions. Push body, Gmail text,
mailbox, tenant, connection, credentials, bearer/access/refresh tokens, authorization headers,
provider bodies, and request/provider URLs remain excluded. Provider and persistence failures use
fixed internal codes/messages.

## Local End-To-End Harness

`pnpm e2e:local` resets a local Supabase stack, starts local API and Wrangler processes, and sends the
shared synthetic mobile fixture through the complete encrypted ingress path. The harness verifies
encrypted Supabase persistence, typed facts with exact money and field provenance, source-identity and
fingerprint deduplication, acknowledgement after durable persistence, cold database conflict outcomes,
duplicate-cache safety, dead-letter metadata delivery, operator inspection, exact encrypted replay,
terminal replay cleanup, action-run absence, and controlled seven-day retention cleanup. It
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
components, fixed failure code, original identity/expiry, replay state, and validated original AAD ID
text. AAD text must be UUID-equivalent to canonical database IDs; legacy NULL AAD columns fall back to
those canonical IDs. Authenticated users have no table or RPC access. Dedicated operator API returns
metadata only; it has no decrypt operation.
Coordinator maps configuration, unavailable key version, invalid ciphertext/envelope, persistence,
tenant-conflict, fact-integrity, and invalid-response failures to fixed codes without reflecting error
text. Final attempt republishes that metadata beside ciphertext to existing dead-letter Queue. If
durable recovery storage is unavailable, DLQ consumer parks exact message back onto same Queue with
bounded delay until original expiry.

Replay atomically claims one unexpired item with stable request UUID and republishes exact ciphertext,
original-casing encryption context, source identity, and original expiry. Dead-letter KEK rotation uses
same original AAD text while compare-and-set identity remains canonical. Queue completion records `succeeded` or
`duplicate`, destroys recoverable dead-letter encryption fields, and writes metadata-only audit rows.
An ambiguous Queue publication or failed replay retains same active request ID; only retry with that
ID can republish it. Repeated completion is idempotent. Terminal or expired rows cannot regain ciphertext. Source unique
constraints and coordinator dedupe remain final arbitration, and recovery cannot create action rows
while action dispatch is disabled. Uncertain classification remains visible in inbox; it must not
silently become an external effect.

Related: [action model](action-model.md), [privacy lifecycle](../security/privacy.md).
