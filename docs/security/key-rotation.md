---
status: accepted
owner: security
last_verified: 2026-08-28
---

# Secret Provisioning And KEK Rotation

## Secret Inventory

Shared hosted runtime uses one secret set. Store runtime values only in platform secret stores and
recovery copy only in maintainers' password manager.

| Secret                         | Runtime owners       | Purpose                                      |
| ------------------------------ | -------------------- | -------------------------------------------- |
| `GOOGLE_CLIENT_ID`             | API Worker           | Identify Google connector OAuth client       |
| `GOOGLE_CLIENT_SECRET`         | API Worker           | Authenticate Google connector OAuth client   |
| `RELAY_CREDENTIAL_KEK_KEYRING` | API, Pipeline Worker | Wrap per-record data keys                    |
| `RELAY_INGEST_SHARED_SECRET`   | API, Pipeline Worker | Authenticate internal ingestion              |
| `RELAY_RECOVERY_SHARED_SECRET` | API, Pipeline Worker | Authorize metadata inspection and replay     |
| `SUPABASE_SERVICE_ROLE_KEY`    | API, Pipeline Worker | Perform tenant-bound persistence and cleanup |
| `SUPABASE_URL`                 | API, Pipeline Worker | Select canonical hosted data plane           |

`SUPABASE_SERVICE_ROLE_KEY` is retained as the binding name, but its value must be the dedicated
modern `sb_secret_` backend key. Send it only as Supabase's `apikey` header; it is not a JWT and must
not appear in an `Authorization` header. Publishable keys fail Pipeline startup validation.

Never place these values in Wrangler configuration, Supabase metadata, EAS public variables,
command arguments, issue comments, CI output, or application logs. Stream values from password
manager into platform secret commands through standard input. Issue #63 owns shared Worker topology;
issue #9 owns Supabase project access and key lifecycle.

## Keyring Contract

`RELAY_CREDENTIAL_KEK_KEYRING` is a JSON secret with one active positive integer version and one or
more base64-encoded 32-byte AES keys. Generate ingress and recovery secrets independently with at
least 32 random bytes; neither credential substitutes for other:

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
selects key recorded on each ciphertext bundle. Generate hosted KEK from cryptographically secure
32-byte source.

When each version activates, create a known-plaintext synthetic canary bundle with fixed context and
store that non-user ciphertext beside the version metadata. Retain the canary until the KEK and every
backup requiring it are destroyed. A restored key must decrypt the historical canary; generating new
ciphertext with a candidate key proves nothing about old records.

Encrypted database rows retain `encryption_environment='production'` as stable hosted keyring and
inventory scope under ADR-0007. It does not identify separate deployment. Connection credentials use
`connection:<user-id>:<connection-id>:credential` as encryption context. Source items retain ingress
context `ingress:<user-id>:<source-item-id>`. Context formats are immutable for existing ciphertext.
Dead-letter rows preserve same ingress context with envelope ID, even though recovery row ID is stored
separately.

When migrating from `RELAY_CREDENTIAL_KEK`, keyring entry `"1"` must contain those exact existing
bytes. Do not generate a replacement version `1`. Before deployment, inventory Supabase rows,
Durable Object local records, ingress Queue messages, and dead-letter messages. If any legacy
ciphertext exists, retain its KEK in the keyring. If none exists, record that nonsecret inventory
result as migration evidence.

Before provisioning, verify locally with synthetic values:

```bash
npx pnpm@11.23.0 --filter @relay/crypto test
```

Provision each hosted value once. Platform command must read secret from standard input rather than
exposing it in shell history:

```bash
<password-manager-read-command> | pnpm --filter @relay/pipeline exec wrangler secret put RELAY_CREDENTIAL_KEK_KEYRING
<password-manager-read-command> | pnpm --filter @relay/api exec wrangler secret put RELAY_CREDENTIAL_KEK_KEYRING
```

Record secret owner, creation time, hosted runtime, and active version in password manager. Do not
record secret values in project documentation.

Before decommissioning historical development Worker, inventory
`public.kek_encryption_inventory('development')`, development Queue and DLQ backlogs, Durable Object
state, Workflow instances, and backups. Development keyring or recovery copy cannot be retired until
every inventory is zero and Queue retention gate has elapsed. Never substitute hosted production KEK
for development-labeled ciphertext.

## Rotation

1. Generate version `N+1` in the password manager. Keep version `N`; install both keys with version
   `N` still active so every runtime can decrypt existing records.
2. Change `activeVersion` to `N+1`, replace the Worker secret, and verify synthetic ingress. New
   writes now use `N+1`; old records remain readable through lookup.
3. The private Pipeline Worker's hourly schedule purges expired raw payloads, inventories its own
   hosted scope, and rewraps at most five rows from each of `connections`, `source_items`, and
   `dead_letter_items` per invocation. It aborts before writes when storage contains a future version
   or an old version absent from the keyring.
4. The executor calls `rewrapValue` with the canonical row context. Service-role-only Supabase RPCs
   compare row ID, tenant ID, environment, previous key version, wrapped key, wrap nonce, ciphertext,
   and payload nonce, then update only `wrapped_data_key`, `wrap_nonce`, and `key_version`. RPC bodies,
   not URLs, carry encrypted comparison values.
5. On a compare-and-set mismatch, reread the row. A deleted, expired, or already-active row is a
   no-op. Rewrap the refreshed tuple and retry once; defer a second conflict to the next hourly batch.
   Never pair a rewrap result from the stale read with refreshed ciphertext.
6. Count remaining hosted live rows by key version:

   ```sql
   select * from public.kek_encryption_inventory('production');
   ```

7. Drain ingress and dead-letter Queues or wait at least 48 hours after activation. Each Queue has
   24-hour retention on the Free plan, and movement from ingress to the dead-letter Queue starts a
   second retention period. Verify both backlogs are empty. Replaying an old-version message resets
   the gate unless replay rewraps its data key under the original ingress context.
8. Retire version `N` from the online keyring only after database inventories contain no version-`N`
   rows, the Queue gate completes, Durable Object local-development records are clear, and every
   backup or export containing version `N` has expired or been destroyed.
9. Keep any backup-recovery copy under separate access control until backups encrypted with version
   `N` expire. Then destroy that copy and record destruction time without recording key material.

The executor never changes or retires a keyring. Activation and retirement remain explicit operator
actions. Run no manual row updates around the compare-and-set RPCs.

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
2. Generate and activate a higher version in hosted runtime.
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
compatible code instead of resuming under old or compromised KEK. Deployment records must track
highest hosted version.

Related: [privacy lifecycle](privacy.md), [threat model](threat-model.md),
[ADR-0007](../decisions/0007-shared-hosted-runtime.md), and
[ADR-0005](../decisions/0005-versioned-wrapping-keys.md).

## Sources

- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare Queue limits and retention](https://developers.cloudflare.com/queues/platform/limits/)
- [Cloudflare Queue configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/)
