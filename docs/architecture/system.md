---
status: accepted
owner: architecture
last_verified: 2026-08-26
---

# System Architecture

## Components

| Component             | Owns                                                            | Must not own                                  |
| --------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| Expo mobile           | Consent, source settings, local capture queue, inbox UI         | Service credentials, classification authority |
| Next API              | User auth, recovery auth, validation, connector setup           | Long processing, provider effects             |
| Pipeline Worker       | Queue/DLQ processing, orchestration, filters, provider dispatch | Primary user identity UI                      |
| Tenant Durable Object | Per-user/source ordering and short-lived coordination           | Sole permanent idempotency record             |
| Cloudflare Workflow   | Approval waits, retry-safe provider steps                       | Undocumented arbitrary actions                |
| Supabase              | Auth, RLS, encrypted durable data, audit and action ledger      | Plaintext credentials or raw payloads         |

Shared wire shapes live in `packages/contracts`. Pure domain rules live in `packages/domain`.
Envelope encryption lives in `packages/crypto`.

## Trust Boundaries

Mobile and external callbacks are untrusted until authenticated and validated. Queue messages are
internal but remain schema-validated because deployments and retries can mix versions. Source text
is untrusted throughout classification and AI evaluation. Provider responses are untrusted and
validated before persistence.

## User Identity Flow

Mobile requests an email magic link for an existing approved account with PKCE and the exact
`com.redsteadz.relay://auth/callback` redirect. The callback route accepts one bounded authorization
code, exchanges it without logging provider details, and persists the refreshable session through
Expo SecureStore. Mobile sends the current access token as a bearer credential and refreshes only
while the native app is active. Sign-out clears only this device's local session; other device
sessions remain explicit user-controlled state.

The API does not decode unverified token claims. It asks the environment's configured Supabase Auth
service for the user, validates the returned user ID as a Relay UUID, then forwards only that ID to
the pipeline. Missing, malformed, expired, and wrong-project credentials receive stable `401`
responses. Synthetic development identity header is accepted only in local non-production runtime.
Automatic account creation remains disabled as operator-controlled enrollment policy, not an
infrastructure-isolation gate.

Each mobile user installation generates a random UUID and stores it in SecureStore under a
user-specific key. An authenticated registration RPC derives ownership from `auth.uid()` and creates
the synthetic display name; clients cannot write device rows or choose tenant identity. Before Queue
publication, API atomically authorizes active ownership and updates only `last_seen_at`. Revocation is
monotonic: revoked IDs cannot register again or authorize new ingestion. Ingress authorized before a
revocation commit may complete Queue publication; authorization after that commit fails. Published
work remains durable and carries only verified user identity plus canonical envelope.

Related: [data flow](data-flow.md), [threat model](../security/threat-model.md),
[ADR-0002](../decisions/0002-cloudflare-processing-boundary.md).
