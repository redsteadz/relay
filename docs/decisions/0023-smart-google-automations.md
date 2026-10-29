---
status: accepted
date: 2026-10-23
owners: maintainers
---

# ADR-0023: Google automations extend the action ledger

The approved Smart Automations core adds Sheets and Calendar beside the existing Tasks adapter.
It reuses canonical capture, facts, events, server classification, encrypted connections,
`action_rules`, `action_runs`, authenticated decisions, and audit history. It introduces no second
approval ledger and no provider calls in API handlers.

Strict contracts describe service configuration, rule policy, observations, and action previews.
Pure domain functions evaluate source/sender/confidence policy and derive effect identities.
Pipeline proposes into the existing ledger, allocates fixed spreadsheet rows transactionally, and
drains a durable outbox into bounded Workflow steps. Dispatch rechecks authorization and rule
revision before calling a code-owned provider operation. Source text cannot supply an endpoint,
credential, operation, attendees, or executable instructions.

Authorization is incremental per service. Refresh tokens use the existing connection envelope
encryption and rotation protocol. Existing connector endpoints remain supported. Google grant
revocation may affect other service tokens for the same project/account; service switches and
local disconnection are distinct from revoking the upstream grant.

The core is disabled unless `RELAY_SMART_GOOGLE_ENABLED=true` in both API and Pipeline. Synthetic
Expo demo behavior is isolated from live provider execution. Secondary integrations remain out of
this change. Operational constraints and verification are maintained in the
[canonical integration guide](../integrations/smart-google-automations.md).
