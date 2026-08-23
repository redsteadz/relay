---
status: accepted
owner: architecture
last_verified: 2026-08-24
---

# System Architecture

## Components

| Component             | Owns                                                                  | Must not own                                  |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| Expo mobile           | Consent, source settings, local capture queue, inbox UI               | Service credentials, classification authority |
| Next API              | User auth, callback verification, schema validation, connector setup  | Long processing, provider effects             |
| Pipeline Worker       | Queue consumption, orchestration, filter execution, provider dispatch | Primary user identity UI                      |
| Tenant Durable Object | Per-user/source ordering and short-lived coordination                 | Sole permanent idempotency record             |
| Cloudflare Workflow   | Approval waits, retry-safe provider steps                             | Undocumented arbitrary actions                |
| Supabase              | Auth, RLS, encrypted durable data, audit and action ledger            | Plaintext credentials or raw payloads         |

Shared wire shapes live in `packages/contracts`. Pure domain rules live in `packages/domain`.
Envelope encryption lives in `packages/crypto`.

## Trust Boundaries

Mobile and external callbacks are untrusted until authenticated and validated. Queue messages are
internal but remain schema-validated because deployments and retries can mix versions. Source text
is untrusted throughout classification and AI evaluation. Provider responses are untrusted and
validated before persistence.

Related: [data flow](data-flow.md), [threat model](../security/threat-model.md),
[ADR-0002](../decisions/0002-cloudflare-processing-boundary.md).
