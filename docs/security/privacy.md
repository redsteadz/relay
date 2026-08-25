---
status: accepted
owner: security
last_verified: 2026-08-25
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
plaintext. Environment-owned rows, private hourly rotation batches, exact compare-and-set updates,
historical canaries, and separate platform keyrings enforce rotation without payload decryption.

Supabase RLS isolates users. Service-role operations still bind explicit tenant identity from
verified authentication or connector ownership. Users can inspect disclosure and action history.

During the hackathon, hosted development and demo-production share one Supabase project under
[ADR-0006](../decisions/0006-shared-supabase-hackathon-backend.md). That project accepts synthetic
fixtures only. Issue [#63](https://github.com/redsteadz/relay/issues/63) must restore isolated
production before beta access, non-maintainer accounts, credentials granting access to real sources,
or real source data.

OpenAI receives only semantic-clause allowlisted fields after redaction. Relay stores disclosure
metadata, not model prompts containing raw source bodies. Source content is delimited as data and
cannot choose tools or action configuration.

Related: [key rotation](key-rotation.md), [threat model](threat-model.md),
[filter model](../architecture/filter-model.md), and
[Supabase operations](../operations/supabase.md).
