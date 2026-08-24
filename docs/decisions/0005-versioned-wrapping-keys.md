---
status: accepted
date: 2026-08-24
owners: maintainers
---

# ADR-0005: Versioned Wrapping Keys

## Context

Replacing one unversioned wrapping key makes existing ciphertext undecryptable. Re-encrypting raw
payloads during rotation would expose source content and credentials unnecessarily. Binding payload
authentication to the KEK version would also force payload decryption whenever the KEK changes.

## Decision

Store a versioned KEK keyring as one Cloudflare secret per environment. Each encrypted bundle records
the KEK version used to wrap its random data key. New writes use the active key; reads resolve the
recorded version.

Payload AES-GCM associated data binds record context to stable encryption format version `v1`.
Wrapped-key associated data binds the same context and the KEK version. Rotation unwraps and rewraps
only the data key, then updates wrapped key, wrap nonce, and KEK version with compare-and-set storage.
Payload format `v1` is immutable for the `AES-GCM-256` bundle identifier. Any future AAD format needs
a new bundle identifier and persisted schema before writes begin.

## Consequences

Old KEKs remain available until live data and retained backups no longer require them. Losing a
required KEK makes affected ciphertext unrecoverable. A compromised KEK requires a higher active
version, data-key rewrap, and controlled retirement; payload plaintext never enters the rotation
path.

Related: [secret provisioning and rotation](../security/key-rotation.md) and
[privacy lifecycle](../security/privacy.md).
