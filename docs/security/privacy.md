---
status: accepted
owner: security
last_verified: 2026-08-24
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

Wrapping key material lives in Cloudflare secrets, never Supabase or clients. Ciphertext records
include algorithm, nonce, wrapped data key, wrapping nonce, and key version to permit rotation.
AES-GCM associated data binds tenant, record, purpose, and key version so ciphertext bundles cannot
be moved between records without authentication failure.

Supabase RLS isolates users. Service-role operations still bind explicit tenant identity from
verified authentication or connector ownership. Users can inspect disclosure and action history.

OpenAI receives only semantic-clause allowlisted fields after redaction. Relay stores disclosure
metadata, not model prompts containing raw source bodies. Source content is delimited as data and
cannot choose tools or action configuration.

Related: [threat model](threat-model.md), [filter model](../architecture/filter-model.md).
