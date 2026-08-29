---
status: accepted
owner: integrations
last_verified: 2026-08-29
sources:
  - https://developers.google.com/gmail/api/guides/push
  - https://cloud.google.com/pubsub/docs/push
  - https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
  - https://developers.cloudflare.com/durable-objects/api/alarms/
  - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list
  - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile
  - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/stop
  - https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch
  - https://developers.google.com/workspace/gmail/api/guides/handle-errors
  - https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
  - https://cloud.google.com/pubsub/docs/subscription-message-retention
---

# Gmail

Relay uses separate connector OAuth rather than treating Supabase login as mailbox authorization.
MVP runs with allowlisted Google OAuth testing users while production verification is prepared.

Gmail `watch` publishes mailbox cursor notifications through Google Cloud Pub/Sub. Push payloads
contain email address and History ID, not message content. Relay verifies Pub/Sub push identity,
resolves connector ownership, serializes each mailbox cursor through a Durable Object, and calls
Gmail History API with encrypted refresh credentials.

API accepts push only after verifying Google remote-JWKS `RS256` signature, accepted Google issuer,
exact configured audience, expiration, exact configured service-account email, and boolean
`email_verified=true`. It bounds request body before buffering, then strictly validates Pub/Sub
wrapper and base64url cursor. Only normalized email plus decimal-string History ID crosses private
Pipeline binding. Missing verification configuration, unknown or ambiguous ownership, and failure to
persist highest pending cursor all return non-success so Pub/Sub retries. Errors and telemetry use
fixed metadata only; push data, mailbox, token, authorization header, tenant, connector, URL, and
provider body are excluded.

Wrapped Pub/Sub delivery documents both camelCase `messageId`/`publishTime` and snake_case
`message_id`/`publish_time` aliases. Relay accepts optional snake_case aliases only when each exactly
matches its required camelCase partner, strips aliases to one canonical shape, and continues rejecting
unknown wrapper fields.

Active Gmail mailbox ownership is globally unique after normalization. Connector OAuth state uses
authenticated encryption under versioned credential KEK, validates UUID/state/verifier/expiry, and
cannot supply forgeable tenant identity. OAuth persistence requires granted `gmail.readonly`, reads
mailbox identity from Gmail `users/me/profile`, and atomically creates encrypted connection plus
initial Gmail state. Pre-existing ambiguous active ownership blocks migration rather than selecting
tenant.

Pipeline routes `gmail:<connection-id>` through existing `TENANT_COORDINATOR`. Durable Object stores
user/connection identity and highest pending decimal History ID before acknowledgement, compares IDs
with `BigInt`, and coalesces lower pushes. Active work retains immutable start and target cursors while
newer pushes update separate pending state. Each alarm performs at most one `history.list` request for
at most 20 History records or fetches and publishes at most ten messages. One provider-bounded History
response can contain thousands of changed message IDs; Pipeline validates at most 25,000 candidates
inside its 512 KB response ceiling, stores stable chunks of 100 IDs in Durable Object storage, and
deletes each drained chunk. Durable page-token, page-count, chunk-index, message-index, and hashed seen
markers resume after eviction without loading an unbounded mailbox window. Chunk completion atomically
advances work and removes that chunk's message markers; page completion removes its page marker before
the next page. Cross-page duplicate IDs can therefore republish, but deterministic envelope UUID plus
Queue/Supabase deduplication makes that retry idempotent without retaining up to 10,000 pages of marker
state.

Durable Object alarm failures do not rely on Cloudflare's six automatic retries. Relay catches fixed
failure outcomes without logging errors, persists attempt count plus next-attempt timestamp, doubles
delay from two seconds up to five minutes, caps stored count at 16, and explicitly schedules every
retry. Successful progress clears retry metadata. Every Gmail alarm write preserves an already-earlier
alarm, including local encrypted-payload retention work sharing same coordinator. Whole mailbox alarm
execution has a four-minute deadline. Each Supabase, Google, and Queue operation inside that alarm has
a 15-second deadline and receives an abort signal where platform API supports one.
Timeout leaves durable phase unchanged and schedules same retry path; Queue retries retain deterministic
envelope ID because Queue publication may have completed before timeout.

Pipeline decrypts refresh credential in memory with user/connection AAD, refreshes access token, and
requests `historyTypes=messageAdded` without attachment calls. Canonical Gmail envelopes use
deterministic UUID per connection/message, connection UUID as account, provider message ID as external
ID, bounded sender/subject/plain-text body, and explicit truncation metadata, including omitted
attachment-backed text. Queue publication uses generic encrypted ingress path. Supabase cursor uses
compare-and-set only after every page and changed message reaches Queue. Lost Queue responses retry
same deterministic envelope ID; lost cursor responses detect already-advanced Supabase state and
finish durable cleanup without republishing. Encrypted ingress plaintext authenticates producer as
either `device` or `gmail-provider`; only provider provenance can carry reserved `source.kind=gmail`.
Authenticated device and generic private ingress reject Gmail claims before Queue publication, and
Queue consumption validates same producer/source binding after decryption.

Provider response buffering remains fixed at one megabyte per message. Header traversal keeps at most
200 entries, MIME traversal remains bounded, labels keep at most 100 IDs, and canonical envelope JSON
is reduced to an explicit 80,000-byte pre-encryption Queue budget with truncation flags. A malformed or
over-limit message response, or final encrypted Queue-budget rejection, writes one tenant-bound
terminal receipt keyed by SHA-256 message-ID digest plus one metadata-only audit row. Lost receipt
responses repeat idempotently. Provider 404 receives fixed missing-message terminal reason. Durable
message progress advances only after Queue acceptance or terminal receipt commit, so later messages
continue while transient network, interrupted response streams, rate-limit, and provider 5xx failures
retain retry state. Complete bounded responses that are malformed or oversized remain deterministic
terminal outcomes. Terminal receipts expire after seven days and hourly retention purges them.

Watches expire within seven days and should renew daily. Push delivery can be delayed or dropped;
periodic History reconciliation remains required. Per-user notification rate is limited, so cursors
must coalesce rather than assume one push per message.

Hourly maintenance excludes stale connectors, atomically claims at most 50 active rows with locked
selection, and moves claimed due timestamps to a finite two-hour retry lease before scheduling daily
watch renewal plus periodic reconciliation through same mailbox Durable Object. Failed scheduling
becomes eligible after lease expiry while later due rows receive next batch. Before first
`watch`, Durable Object persists `watch-call-in-flight`; successful response baseline and expiration
become durable before either Supabase write. Watch metadata and baseline commits can retry
idempotently. An immediate push accepted after `baseline-ready` coalesces as pending while persisted
baseline commits first; it is processed from that baseline afterward. Only restart with
`watch-call-in-flight` and no returned baseline marks fixed `initialization-ambiguous` resync-required
state. Bounded HTTP `400`, `401`, `403`, `404`, and `429` are definitive rejected watch requests, so
Relay clears in-flight state and retries with durable backoff. HTTP `408`, any `5xx`, fetch rejection,
interrupted body, timeout, and malformed successful response remain ambiguous after possible provider
success; Relay marks resync-required and never repeats an ambiguous first watch or guesses which
baseline won. Returned expiration must be in future and no later than seven days plus five-minute
clock tolerance; Pipeline and Supabase both reject values outside that bound. Renewal response on
established mailbox becomes pending History target and does not mutate active work. Gmail History
`400` or `404`, repeated/invalid continuation, missing chunks, and exhausted page bound mark fixed
resync-required state. Relay does not retry a permanently invalid page token, guess full-sync baseline,
or silently skip unavailable history. Mailbox failures remain isolated from retention, KEK rotation,
and other mailboxes.

Hourly retention purge, KEK rotation, and Gmail maintenance start concurrently as independent attempts.
Each whole job has a 30-second timeout and abort signal. Failure or timeout in one records fixed
metadata-only failure metric, does not suppress other two, and rejects scheduled run only after all
three have settled.

Disconnect is consent withdrawal, not best-effort cleanup. Authenticated API validates tenant and
connection IDs and routes a private request. Durable Object first persists tenant-scoped disconnect
intent and schedules alarm, then performs bounded ownership lookup. Intent alone does not establish
canonical mailbox identity or authorize provider calls; unknown/cross-tenant intent is removed without
credential access. Once ownership is active, Durable Object promotes intent to disconnect phase before
synchronous provider work. Synchronous path uses same four-minute whole-operation and 15-second
abort-propagating external-operation deadlines as alarm path; timeout returns retryable failure while
durable intent or phase and alarm remain. Alarm resumes without holding later serialized coordinator
requests. Pending disconnect intent preempts initialized watch, History, and message work on every
alarm; transient ownership or disconnect failure retains intent/phase and schedules future attempt.
Malformed, identity-conflicting, already-completed, and cross-tenant rejected intents are deleted
without provider access and always schedule immediate follow-up so unrelated initialized Gmail work is
not stranded.
Pipeline decrypts credential only in memory, calls Gmail `users.stop`, revokes Google refresh grant,
then invokes one idempotent Supabase transaction keyed by stable Relay removal action ID. Transaction
first disables and detaches every tenant/connection-bound action rule, then deletes encrypted credential
and writes metadata-only receipt/audit rows. Detached rules remain inspectable but cannot dispatch.
Stop or revoke failure retains credential required to retry. Lost provider or database responses resume
same phase with same action ID; already-invalid token and completed database receipt converge without
repeating later effects.

Authenticated table RLS cannot directly delete active Gmail connections; non-Gmail and inactive Gmail
deletion behavior remains unchanged. OAuth refresh `invalid_grant` is terminal evidence that provider
grant is already revoked: Relay records token revocation as complete, records watch stop as unavailable,
and finishes credential deletion instead of retrying forever. During normal History, watch, or message
processing, Relay first persists automatic revocation work with deterministic action ID, then invokes
same disconnect transaction without another Google call. Lost transaction response resumes from that
durable work and same receipt. Metadata-only removal marker starts `pending`; cursor, maintenance, and
disconnect retries receive retryable failure and keep alarm while database cleanup remains unconfirmed.
Only successful idempotent disconnect RPC—including credential deletion, action-rule detachment, and
receipt commit—promotes marker to `completed`. Lost successful response repeats same action ID and uses
receipt to reconcile before promotion. Completed marker contains tenant/connection UUIDs, action UUID,
fixed reason, phase, and expiry—never mailbox, content, or credential. Conservative expiry covers
maximum accepted Gmail watch horizon plus configured Pub/Sub retention, so pre-resolved cursor,
maintenance, and disconnect deliveries acknowledge terminal state after database mapping deletion
without recreating work or calling Google. Alarm removes marker and identity only after that boundary.
Completed receipts resolve only for same tenant and make repeated disconnect return same success after
active row deletion. Cross-tenant and random IDs remain indistinguishable absence.

Disconnect transaction also stores normalized-mailbox SHA-256 tombstone, without mailbox, credential,
or content. Tombstone expires at later of disconnect time and saved Gmail watch expiration, plus exact
configured effective Pub/Sub message retention. Google documents seven-day subscription default and
configurable range from ten minutes through 31 days; enabled topic retention can increase effective
retention to greater configured duration. Authenticated late push matching one unexpired tombstone is
acknowledged without routing Durable Object work. Unique active ownership takes precedence over old
tombstone after reconnect; unknown and expired mailboxes fail closed. Resolver and hourly retention
purge expired tombstones.

Required release work includes minimum-scope analysis, OAuth verification, Google API Services User
Data Policy review, deletion behavior, and documented disclosure before Gmail data can reach OpenAI.
Gmail content remains encrypted under normal seven-day source retention. Only provider-neutral
normalization runs after Queue decryption; Gmail-specific retrieval and canonicalization stay in
Pipeline provider adapter.

Hosted configuration requires API `GOOGLE_PUBSUB_AUDIENCE` and
`GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL`; both must match Pub/Sub authenticated-push settings exactly.
API and Pipeline each receive `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` through Worker secrets.
Pipeline also receives `GOOGLE_GMAIL_PUBSUB_TOPIC` as exact
`projects/{project}/topics/{topic}` resource name. Local placeholders are documented in root
`.env.example` and Pipeline `.dev.vars.example`; real values never enter version control. Non-secret
`GOOGLE_PUBSUB_MESSAGE_RETENTION_SECONDS` must match effective maximum of subscription and topic
settings and remain within Google's 600-to-2,678,400-second range; checked-in production default is
604,800 seconds.
