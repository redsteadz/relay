---
status: accepted
owner: security
last_verified: 2026-08-30
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
| Filter compiler authority injection | Source-free strict requests, typed plan, no action/provider fields       |
| Derived-content leakage             | Fact-only bounded events, path provenance, no body/reference copies      |
| Queue replay                        | Source IDs, fingerprints, unique DB constraints, stable action IDs       |
| Dead-letter operator overreach      | Dedicated secret, metadata-only API, backend-only RPCs, no decrypt route |
| Retention resurrection by replay    | Authenticated original expiry, atomic claim, terminal ciphertext purge   |
| Ambiguous provider timeout          | Provider idempotency or reconciliation before retry                      |
| Malicious callback                  | Google Pub/Sub JWT audience verification, signed webhook authentication  |
| Credential leakage in observability | Structured metadata-only logs, header/body redaction                     |
| Unwanted notification deletion      | Explicit deterministic rules, dry run, audit, no category-only dismissal |
| Compromised device                  | SecureStore ID, active-device gate, revocable record                     |
| SSRF through Nextcloud/webhook URL  | HTTPS requirement, address validation, redirect policy, re-resolution    |

## Open Risks

Gmail restricted-scope verification, Google API Limited Use review, SMS distribution approval,
provider reconciliation details, abuse/rate limits, and account-deletion fresh-auth, external receipt,
post-delete verification, and provider-failure tradeoff need tracked release issues.

One hosted runtime creates shared quota, deployment, backup, and operator blast radius. ADR-0007
accepts that topology for current stage; tenant controls remain mandatory. Account enrollment remains
operator controlled until dedicated registration and abuse controls exist.

Related: [key rotation](key-rotation.md), [system boundaries](../architecture/system.md), and
[MVP scope](../product/scope.md).
