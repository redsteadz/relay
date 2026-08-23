---
status: accepted
owner: security
last_verified: 2026-08-24
---

# Threat Model

## Protected Assets

Raw communications, OAuth refresh tokens, Nextcloud app passwords, OpenAI keys, user identity,
filter intent, financial records, calendars/tasks, and action authority.

## Primary Threats And Controls

| Threat                              | Primary controls                                                         |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Cross-tenant data access            | Supabase RLS, verified user ID, repository tests with two users          |
| Database disclosure                 | Envelope encryption, Cloudflare-held wrapping key, seven-day raw expiry  |
| Prompt injection from source        | Strict data boundary, schema output, fixed provider/rule allowlist       |
| Queue replay                        | Source IDs, fingerprints, unique DB constraints, stable action IDs       |
| Ambiguous provider timeout          | Provider idempotency or reconciliation before retry                      |
| Malicious callback                  | Google Pub/Sub JWT audience verification, signed webhook authentication  |
| Credential leakage in observability | Structured metadata-only logs, header/body redaction                     |
| Unwanted notification deletion      | Explicit deterministic rules, dry run, audit, no category-only dismissal |
| Compromised device                  | SecureStore/Keystore, revocable device record, short offline retention   |
| SSRF through Nextcloud/webhook URL  | HTTPS requirement, address validation, redirect policy, re-resolution    |

## Open Risks

Gmail restricted-scope verification, Google API Limited Use review, SMS distribution approval,
provider reconciliation details, wrapping-key rotation operations, abuse/rate limits, and account
deletion completion need tracked implementation and release issues.

Related: [system boundaries](../architecture/system.md), [MVP scope](../product/scope.md).
