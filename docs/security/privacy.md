---
status: accepted
owner: security
last_verified: 2026-08-26
---

# Privacy And Data Lifecycle

## Data Classes

| Class                           | Storage                                        | Default lifetime                               |
| ------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| Raw email/notification/SMS      | AES-GCM ciphertext with wrapped per-record key | Seven days                                     |
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

## Local Harness

The end-to-end harness uses only the repository's deterministic synthetic fixture and seeded local
users. It creates an ephemeral KEK keyring and ingress secret in an owner-only temporary directory,
removes them after the run, and rejects non-loopback Supabase endpoints. Assertions inspect only
ciphertext, encryption metadata, row counts, and metadata-only Durable Object results. Child process
logs are scanned as streams for fixture or credential leakage and are never retained or replayed by
the harness.

Related: [key rotation](key-rotation.md), [threat model](threat-model.md),
[filter model](../architecture/filter-model.md), and
[Supabase operations](../operations/supabase.md).
