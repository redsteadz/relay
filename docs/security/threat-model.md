---
status: accepted
owner: security
last_verified: 2026-08-26
---

# Threat Model

## Protected Assets

Raw communications, OAuth refresh tokens, Nextcloud app passwords, OpenAI keys, user identity,
filter intent, financial records, calendars/tasks, and action authority.

## Primary Threats And Controls

| Threat                              | Primary controls                                                         |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Cross-tenant data access            | Supabase RLS, verified user ID, repository tests with two users          |
| Magic-link substitution or replay   | Exact callback allowlist, PKCE, one-time bounded code, generic failures  |
| Mobile session disclosure           | SecureStore persistence, active-only refresh, no token or callback logs  |
| Database disclosure                 | Envelope encryption, Cloudflare-held wrapping key, seven-day raw expiry  |
| Wrapping-key loss or compromise     | Required: versioned keyring, data-key rewrap, recovery/incident runbooks |
| Prompt injection from source        | Strict data boundary, schema output, fixed provider/rule allowlist       |
| Queue replay                        | Source IDs, fingerprints, unique DB constraints, stable action IDs       |
| Ambiguous provider timeout          | Provider idempotency or reconciliation before retry                      |
| Malicious callback                  | Google Pub/Sub JWT audience verification, signed webhook authentication  |
| Credential leakage in observability | Structured metadata-only logs, header/body redaction                     |
| Unwanted notification deletion      | Explicit deterministic rules, dry run, audit, no category-only dismissal |
| Compromised device                  | SecureStore ID, active-device gate, revocable record                     |
| SSRF through Nextcloud/webhook URL  | HTTPS requirement, address validation, redirect policy, re-resolution    |

## Open Risks

Gmail restricted-scope verification, Google API Limited Use review, SMS distribution approval,
provider reconciliation details, abuse/rate limits, and account deletion completion need tracked
implementation and release issues.

Mobile sign-in requests do not create accounts while development and demo-production share one
synthetic-only Supabase project. Issue [#63](https://github.com/redsteadz/relay/issues/63) must restore
environment isolation before beta identity enrollment or real source access.

Related: [key rotation](key-rotation.md), [system boundaries](../architecture/system.md), and
[MVP scope](../product/scope.md).
