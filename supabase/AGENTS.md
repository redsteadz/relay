# Database Instructions

- Every user-owned table requires enabled RLS and explicit policies.
- Service-role writes must still carry and validate `user_id` in repository code.
- Migrations are append-only after shared deployment. Never rewrite deployed migration history.
- Credentials and raw payloads use ciphertext, nonce, wrapped key, wrap nonce, and key version.
- Add unique constraints for source identity and external side-effect idempotency.
- Use exact numeric or decimal strings for money; never PostgreSQL float types.
- Test policy behavior as two distinct users before merging access-control changes.

Canonical context: [privacy](../docs/security/privacy.md) and
[threat model](../docs/security/threat-model.md).
