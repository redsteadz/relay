---
status: accepted
owner: security
last_verified: 2026-08-24
---

# Secret Provisioning And KEK Rotation

## Secret Inventory

Development and production use independent values. Store runtime values only in platform secret
stores and the recovery copy only in the maintainers' password manager.

| Secret                         | Runtime owners       | Purpose                                      |
| ------------------------------ | -------------------- | -------------------------------------------- |
| `RELAY_CREDENTIAL_KEK_KEYRING` | Pipeline Worker      | Wrap per-record data keys                    |
| `RELAY_INGEST_SHARED_SECRET`   | API, Pipeline Worker | Authenticate internal ingestion              |
| `SUPABASE_SERVICE_ROLE_KEY`    | Pipeline Worker      | Perform tenant-bound persistence and cleanup |

Never place these values in Wrangler configuration, Supabase metadata, EAS public variables,
command arguments, issue comments, CI output, or application logs. Stream values from the password
manager into platform secret commands through standard input. Issue #7 owns exact Worker environment
names and deployment bindings; issue #9 owns Supabase project access and key lifecycle.

## Keyring Contract

`RELAY_CREDENTIAL_KEK_KEYRING` is a JSON secret with one active positive integer version and one or
more base64-encoded 32-byte AES keys:

```json
{
  "activeVersion": 2,
  "keys": {
    "1": "<base64-encoded-32-byte-key>",
    "2": "<base64-encoded-32-byte-key>"
  }
}
```

Versions increase monotonically and are never reused. New records use `activeVersion`; decryption
selects the key recorded on each ciphertext bundle. Generate each environment's initial KEK from a
cryptographically secure 32-byte source. Generate ingress secrets independently with at least 32
random bytes.

When each version activates, create a known-plaintext synthetic canary bundle with fixed context and
store that non-user ciphertext beside the version metadata. Retain the canary until the KEK and every
backup requiring it are destroyed. A restored key must decrypt the historical canary; generating new
ciphertext with a candidate key proves nothing about old records.

When migrating from `RELAY_CREDENTIAL_KEK`, keyring entry `"1"` must contain those exact existing
bytes. Do not generate a replacement version `1`. Before deployment, inventory Supabase rows,
Durable Object local records, ingress Queue messages, and dead-letter messages. If any legacy
ciphertext exists, retain its KEK in the keyring. If none exists, record that nonsecret inventory
result as migration evidence.

Before provisioning, verify locally with synthetic values:

```bash
npx pnpm@11.23.0 --filter @relay/crypto test
```

Provision each value separately for development and production. A platform command must read the
secret from standard input rather than exposing it in shell history:

```bash
<password-manager-read-command> | pnpm --filter @relay/pipeline exec wrangler secret put RELAY_CREDENTIAL_KEK_KEYRING --env <environment>
```

Record secret owner, creation time, environment, and active version in the password manager. Do not
record secret values in project documentation.

## Rotation

1. Generate version `N+1` in the password manager. Keep version `N`; install both keys with version
   `N` still active so every runtime can decrypt existing records.
2. Change `activeVersion` to `N+1`, replace the Worker secret, and verify synthetic ingress. New
   writes now use `N+1`; old records remain readable through lookup.
3. For each encrypted row, call `rewrapValue` with tenant, record, and purpose context. Persist only
   `wrapped_data_key`, `wrap_nonce`, and `key_version`; ciphertext and payload nonce must not change.
4. Use a compare-and-set update constrained by row ID, tenant ID, previous key version, wrapped key,
   wrap nonce, ciphertext, and payload nonce. Reread on a mismatch so a concurrent credential refresh
   cannot pair stale wrapped-key material with new ciphertext. Rows already at the active version are
   no-ops.
5. Count remaining live rows by key version in `connections`, `source_items`, and Durable Object local
   records. Drain or replay ingress and dead-letter Queue messages encrypted under version `N`, or
   wait through their maximum retention. Inventory every ciphertext store before retirement.
6. Retire version `N` from the online keyring only after live counts reach zero, queues contain no
   version-`N` messages, and backup-retention requirements are satisfied.
7. Keep any backup-recovery copy under separate access control until backups encrypted with version
   `N` expire. Then destroy that copy and record destruction time without recording key material.

Production rotation needs a pipeline-owned batch executor implementing these compare-and-set and
inventory rules. The `rewrapValue` primitive and synthetic tests are not permission to rotate live
rows manually; issue #6 remains open until executor and platform provisioning are verified.

Rotation unwraps the random 32-byte data key and wraps it under the new KEK. It never decrypts raw
messages or provider credentials. Synthetic tests deliberately replace payload ciphertext before
rewrapping to prove the operation does not inspect payload plaintext.

## Lost Key

1. Stop rotation and pause consumers for affected key versions.
2. Restore the missing version from the password manager recovery copy and decrypt that version's
   retained historical canary before resuming.
3. If no recovery copy exists, affected ciphertext is unrecoverable by design. Quarantine metadata,
   do not substitute another key, and begin the security incident and user-impact process.
4. Never log failed ciphertext, wrapped keys, candidate keys, or secret-store responses.

## Compromised Key

1. Determine whether the attacker could access ciphertext, Queue messages, backups, or provider
   credentials in addition to the KEK. Preserve metadata-only incident evidence.
2. Generate and activate a higher version in the affected environment.
3. Rewrap live data keys using the compare-and-set process, prioritizing long-lived credentials.
4. Revoke and replace provider and OpenAI credentials exposed with the old KEK. Rewrapping does not
   revoke copied ciphertext or credentials; it only prevents future use of the old KEK against
   updated storage.
5. Assess raw-payload exposure and required user notification. Raw content already copied by an
   attacker cannot be recovered through key rotation.
6. Apply the live-row, Queue, dead-letter, and backup gates from the rotation procedure before
   removing the compromised version from online runtimes.
7. Rotate ingress and Supabase credentials too if the compromise boundary could include them.
8. Record versions, row counts, timestamps, and operators. Never record keys or decrypted content.

Never roll `activeVersion` backward during an application rollback. Roll code back while retaining
the highest activated keyring version. If old code cannot use that version, pause writes and restore
compatible code instead of resuming under an old or compromised KEK. Deployment records must track
the highest version activated in each environment.

Related: [privacy lifecycle](privacy.md), [threat model](threat-model.md), and
[ADR-0005](../decisions/0005-versioned-wrapping-keys.md).

## Sources

- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Queue limits and retention](https://developers.cloudflare.com/queues/platform/limits/)
