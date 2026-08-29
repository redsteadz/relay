---
status: accepted
owner: security
last_verified: 2026-08-29
---

# Privacy And Data Lifecycle

## Data Classes

| Class                           | Storage                                        | Default lifetime                               |
| ------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Raw email/notification/SMS      | AES-GCM ciphertext with wrapped per-record key | Seven days                                     |
| Recoverable dead-letter payload | Exact encrypted ingress bundle                 | Original raw-payload expiry, never restarted   |
| Provider and OpenAI credentials | AES-GCM ciphertext with wrapped per-record key | Until revoked/deleted                          |
| Derived facts/events            | Structured tenant-owned rows with provenance   | Until user deletion                            |
| Audit metadata                  | No raw bodies or secrets                       | Product retention policy, currently unresolved |
| Device offline queue            | Keystore-backed encryption                     | Until acknowledged or local expiry             |

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

Relay intentionally uses one hosted Supabase and Cloudflare runtime under
[ADR-0007](../decisions/0007-shared-hosted-runtime.md). Shared failure and operator boundaries do not
relax tenant RLS, encryption, source consent, retention, credential handling, or deletion controls.
Future infrastructure isolation requires measured need rather than serving as user-data gate.

Pipeline application metrics use fixed operation names plus count and latency numbers only. They do
not contain tenant, device, envelope, source, provider, ciphertext, URL, error, credential, or raw
content values. Decrypted JSON parse failures become a fixed invalid outcome before platform
observability can receive parser text.

OpenAI receives only semantic-clause allowlisted fields after redaction. Relay stores disclosure
metadata, not model prompts containing raw source bodies. Source content is delimited as data and
cannot choose tools or action configuration.

## User Controls

Raw payload retention is fixed at seven days and is not user-configurable. A tenant can read how
many encrypted payloads are still retained and when the next cleanup removes them, and can purge
them immediately without waiting for expiry. Purging nulls the encryption columns and keeps the
row, exactly as the scheduled cleanup does, so derived facts, classifications, events, and their
provenance survive; only the recoverable raw body is destroyed.

Disclosure history lists what was sent to OpenAI -- provider, model, disclosed field names, and
purpose -- never the prompt or the source content itself. The stored OpenAI key is revocable.

Account deletion revokes provider credentials, cancels pending action runs, invalidates every
device, deletes stored credentials, purges raw payloads, and then removes the identity, which
cascades every remaining tenant row. It is idempotent at each step, so an interrupted deletion is
resumable and its state remains inspectable while it runs. Deletion requires an explicit typed
confirmation and is irreversible; it is a single deliberate step rather than a repeated or
obstructive flow. Provider revocation is best effort: a provider that refuses or is unreachable is
counted and reported, and never strands the deletion, because Relay still destroys every
credential it holds.

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
