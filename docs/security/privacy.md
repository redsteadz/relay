---
status: accepted
owner: security
last_verified: 2026-08-30
---

# Privacy And Data Lifecycle

## Data Classes

| Class                            | Storage                                                                                  | Default lifetime                               |
| -------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Raw email/notification/SMS       | AES-GCM ciphertext with wrapped per-record key                                           | Seven days                                     |
| Recoverable dead-letter payload  | Exact encrypted ingress bundle                                                           | Original raw-payload expiry, never restarted   |
| Provider and OpenAI credentials  | AES-GCM ciphertext with wrapped per-record key                                           | Until revoked/deleted                          |
| Gmail terminal-message receipt   | Fixed reason plus message-ID SHA-256 digest                                              | Seven days                                     |
| Gmail late-push tombstone        | Mailbox SHA-256 digest and ownership metadata                                            | Watch expiry plus Pub/Sub retention            |
| Gmail disconnect receipt         | Action ID, fixed reason, evidence, rule count                                            | Product retention policy, currently unresolved |
| Gmail disconnect intent          | Tenant and connection UUIDs                                                              | Until ownership rejection or durable phase     |
| Gmail coordinator removal marker | UUIDs, action ID, fixed reason, phase, expiry                                            | Maximum watch horizon plus Pub/Sub retention   |
| Derived facts/events             | Structured tenant-owned rows with provenance                                             | Until user deletion                            |
| Semantic disclosure record       | Provider, model, purpose, field names, redaction counts, decision, confidence, rationale | Until user deletion                            |
| Audit metadata                   | No raw bodies or secrets                                                                 | Product retention policy, currently unresolved |
| Device offline queue             | Keystore-backed encryption                                                               | Until acknowledged or local expiry             |

Production wrapping key material must live in a versioned Cloudflare secret keyring, never Supabase
or clients. Queue bundles include algorithm; current Supabase rows imply `AES-GCM-256` and store
nonce, wrapped data key, wrapping nonce, and KEK version. AES-GCM associated data binds tenant,
record, and purpose to both payload and wrapped key. Payload data uses a stable format version;
wrapped-key data binds the KEK version so rotation can rewrap only the data key without exposing
plaintext. Stable hosted-scope rows, private hourly rotation batches, exact compare-and-set updates,
historical canaries, and versioned platform keyring enforce rotation without payload decryption.

Original acceptance and seven-day expiry are authenticated inside encrypted Queue plaintext and
copied as validated routing metadata. Source and dead-letter persistence use that original expiry;
Queue delay and replay never restart retention. Dead-letter inspection exposes fixed failure and
state metadata only. Replay republishes exact encrypted components, and terminal completion or expiry
destroys ciphertext, nonces, wrapped data key, key version, and encryption scope while preserving
non-content operational metadata.

Supabase RLS isolates users. Service-role operations still bind explicit tenant identity from
verified authentication or connector ownership. Users can inspect disclosure and action history.
Gmail mailbox resolution is service-role-only and requires exactly one globally unique normalized
active connector. Unknown or ambiguous mailboxes fail closed with no fallback tenant. Gmail OAuth
state is authenticated ciphertext under versioned KEK; connector refresh credentials remain encrypted
with user/connection-purpose AAD and are decrypted only in Pipeline memory. Disconnect intent stores
only authenticated tenant and requested connection UUID before bounded ownership resolution; it cannot
authorize credential access or provider calls. Gmail disconnect keeps
encrypted credential until Pipeline confirms push stop and token revocation, then atomically deletes
credential after disabling and detaching connection-bound action rules, while retaining only
tenant-bound disconnect receipt and metadata-only audit evidence. Receipt uses deterministic action ID;
lost-response retries cannot duplicate audit effect. Authenticated RLS cannot delete an active Gmail
row around this ordering. Provider `invalid_grant` records already-revoked/unavailable stop evidence
rather than claiming `users.stop` succeeded. Normal processing persists automatic revocation work
before cleanup and makes no additional Google call after receiving that terminal evidence. Coordinator
retains only tenant/connection UUIDs, deterministic action ID, fixed revocation reason, pending/completed
phase, and expiry. Pending never claims local deletion and returns retryable failure until idempotent
database receipt confirms cleanup; completed marker prevents pre-resolved late internal delivery from
recreating credential work until disconnect tombstone retention has passed. Marker contains no mailbox,
content, or credential.
Short-lived late-push tombstones retain only tenant/connection UUID, SHA-256 mailbox digest, and expiry;
they never route content work. Expiry covers later of disconnect and saved watch expiration plus
configured Pub/Sub message retention; active reconnect ownership takes precedence. Terminal-message
receipts retain fixed reason and message digest for seven days so lost-response retries converge, then
the hourly retention task purges them.

Relay intentionally uses one hosted Supabase and Cloudflare runtime under
[ADR-0007](../decisions/0007-shared-hosted-runtime.md). Shared failure and operator boundaries do not
relax tenant RLS, encryption, source consent, retention, credential handling, or deletion controls.
Future infrastructure isolation requires measured need rather than serving as user-data gate.

Pipeline application metrics use fixed operation names plus count and latency numbers only. They do
not contain tenant, device, envelope, source, provider, ciphertext, URL, error, credential, or raw
content values. Decrypted JSON parse failures become a fixed invalid outcome before platform
observability can receive parser text.

Application failure logs are structured and metadata-only. They may contain a generated request ID,
fixed event/integration/operation names, fixed Relay error codes, HTTP status, retryability, timing,
and retry attempt. They never contain tenant or source identifiers, request/response bodies, URLs,
mailboxes, credentials, tokens, cookies, authorization headers, ciphertext, or arbitrary provider
messages. `DEBUG=relay:api,relay:pipeline` and `EXPO_PUBLIC_DEBUG=relay:mobile` add sanitized stack
frames and cause types/codes; they do not relax those exclusions and are unset by default. Sensitive
keys are recursively redacted before serialization. Relay propagates only bounded generated or
validated `x-relay-request-id` values across Mobile, API, and Pipeline for correlation.
Authenticated Gmail push and provider paths also exclude mailbox, tenant, connection, push/provider
body, URL, credential, bearer/access/refresh token, and authorization header from responses, logs, and
metrics. Canonicalized Gmail sender/subject/plain text is deterministically bounded before generic
encrypted Queue publication; truncation state contains byte counts/booleans, not discarded content.
Malformed or over-limit provider messages retain only fixed terminal reason, tenant/connection UUID,
SHA-256 message-ID digest, and timestamps. Their audit rows contain no source headers, body, mailbox,
provider response, token, or reversible message ID.

The semantic endpoint is configurable and OpenAI-compatible under
[ADR-0012](../decisions/0012-openai-compatible-semantic-endpoint.md), defaulting to OpenAI; a tenant
may point it at a gateway or a locally hosted model, in which case content never leaves their
machine. Wherever it is sent, the same rules hold, and each disclosure records the host it actually
reached rather than assuming OpenAI. The endpoint is validated before use -- HTTPS, no embedded
credentials, and private, loopback, and link-local addresses refused -- so a configurable URL cannot
become a way to probe the runtime's network.

The configured endpoint receives only semantic-clause allowlisted fields after redaction. Relay stores disclosure
metadata, not model prompts containing raw source bodies. Source content is delimited as data and
cannot choose tools or action configuration.

Minimization is pure and happens before any credential is loaded, and a deterministic rejection ends
evaluation without contacting a provider at all. Disclosed values have control and format characters
removed, then email addresses, URLs, key-shaped tokens, payment cards, phone numbers, and long digit
runs replaced with a fixed class placeholder, then a per-field and whole-disclosure character bound
applied; redaction precedes truncation so a secret cannot survive by straddling the cut. The stored
redaction summary carries a field name, a class, and a count, and a database check rejects a row
whose redaction objects carry any other key, so a removed value cannot be recorded beside the note
that it was removed. Each disclosure row also records the decision Relay reached, the model's
confidence and one-sentence rationale, and whether the request actually left the runtime; a fixed
failure reason replaces confidence when no usable answer was received. Every failure -- revoked key,
rate limit, exhausted quota, timeout, oversized or off-schema response -- resolves to undecided, so
no outage can be mistaken for a rule that fired. Disclosures are immutable once written and are
removed only by the whole-account cascade. Queue redelivery re-evaluates and therefore re-discloses;
each attempt is recorded separately rather than collapsed, so the history never claims fewer
disclosures than occurred.

Event extraction consumes only validated typed facts. Event titles and summaries render only bounded
amount/currency plus fixed presence/kind labels; they never copy free-text sender, merchant, location,
subject, body, source snippets, or reference values. Provenance stores fact ordinals and validated field
paths. Resolved times retain canonical UTC text, while ambiguous dates retain no guessed instant or
zone. Low-confidence or ambiguous events stay tenant-visible with `requiresReview=true` and cannot
authorize an automatic effect.

## User Controls

Raw payload retention is fixed at seven days and is not user-configurable. A tenant can read how
many encrypted payloads are still retained and when the next cleanup removes them, and can purge
them immediately without waiting for expiry. Purging nulls the encryption columns and keeps the
row, exactly as the scheduled cleanup does, so derived facts, classifications, events, and their
provenance survive; only the recoverable raw body is destroyed.

Disclosure history lists what was sent to OpenAI -- provider, model, disclosed field names, and
purpose -- never the prompt or the source content itself. The row behind each entry also records
what Relay concluded, how confident the model was, its one-sentence rationale, and whether anything
actually left the runtime, so an attempt that failed before sending is distinguishable from one that
disclosed and then failed. The stored OpenAI key is revocable, and revoking it disables every
enabled filter revision with a semantic clause in the same transaction.

Account deletion revokes provider credentials, cancels pending action runs, invalidates every
device, deletes stored credentials, purges raw payloads, and then removes the identity, which
cascades every remaining tenant row. It is idempotent at each step, so an interrupted deletion is
resumable and its state remains inspectable while it runs. Deletion requires an explicit typed
confirmation and is irreversible; it is a single deliberate step rather than a repeated or
obstructive flow.

Active Gmail connections are an explicit account-deletion boundary exception. API queues authenticated
tenant/connection UUIDs through private Pipeline binding, runs at most four repeat-safe requests under
one shared 20-second deadline, and counts timed-out or unstarted requests as failures. Pipeline alone may
load and decrypt Gmail credential, call `users.stop`, revoke Google grant, and commit stable disconnect
receipt in that order. API neither selects Gmail credential columns nor calls Gmail/Google for those
connections, avoiding double revocation. If Pipeline or provider fails, local account finalization still
proceeds: irreversible deletion must not be stranded by external availability, even though destroying
local credential can leave provider grant or watch active with no later Relay retry. This differs from
ordinary Gmail consent withdrawal, which retains credential for Pipeline retry until provider ordering
completes. No branch logs plaintext, mailbox, credential, token, provider body, or authorization header.
Outstanding automatic Pipeline revocation that observes post-finalization ownership absence clears all
coordinator state and alarm without another provider call; detailed retry and tombstone behavior lives
in [Gmail](../integrations/gmail.md).
Other provider revocation remains best effort under same tradeoff; OpenAI has no revocation endpoint,
so local credential destruction is its complete cleanup.

### Retention Exceptions

Deletion removes tenant rows from the live database immediately. Two classes of copy are outside
that boundary and are deliberately not claimed as deleted:

- **Managed database backups.** The hosted Supabase project's automated backups are retained on the
  provider's schedule, so a deleted tenant's rows can persist inside a backup image until that
  backup ages out. Relay does not rewrite backup contents. The exact retention window follows the
  hosted project's plan and is recorded with the project configuration rather than restated here,
  where it would drift.
- **Platform and application logs.** Request and platform logs are metadata only -- fixed operation
  names, counts, and latency -- and by policy contain no tenant identifier, source content,
  credential, or ciphertext, so they hold nothing to delete. Cloudflare and Supabase retain their
  own platform logs under their retention, outside Relay's control.

Audit rows are tenant-owned and cascade with the account. The product-level retention policy for
audit metadata as a class remains unresolved and is tracked with the data-class table above.

## Local Harness

The end-to-end harness uses only the repository's deterministic synthetic fixture and seeded local
users. It creates an ephemeral KEK keyring, ingress secret, and recovery secret in an owner-only temporary directory,
removes them after the run, and rejects non-loopback Supabase endpoints. Assertions inspect only
ciphertext, encryption metadata, recovery states, row counts, and metadata-only Durable Object results. Child process
logs are scanned as streams for fixture or credential leakage and are never retained or replayed by
the harness.

Related: [key rotation](key-rotation.md), [threat model](threat-model.md),
[filter model](../architecture/filter-model.md), and
[Supabase operations](../operations/supabase.md).
