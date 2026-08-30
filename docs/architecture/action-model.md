---
status: accepted
owner: architecture
last_verified: 2026-08-29
---

# Action And Approval Model

Filters create typed action proposals. Provider, operation, connection, and input template come from
an enabled user-owned action rule, never source content or model output.

Default state is `awaiting-approval`. User approval persists before Workflow continuation. A rule may
use `automatic` only after explicit opt-in. Provider actions have stable action UUIDs and a unique
rule/event constraint.

Workflow states are proposed, awaiting approval, approved, running, succeeded, failed, or cancelled.
Retries increment attempts without changing action identity. Provider responses store references,
not copied account data.

Connection removal atomically disables and detaches every action rule bound to that tenant/connection
before deleting credential-bearing connection row. Rule remains inspectable with `enabled=false` and
`connection_id=null`; it cannot silently target a replacement connection. User disconnect and automatic
provider revocation use deterministic Relay removal action IDs so lost database responses repeat same
metadata-only receipt rather than duplicate audit effects.

Notification dismissal is separate from provider action approval. It requires explicit source and
filter scope, deterministic match, confidence policy, completed dry run, and audit record. AI-only
matches cannot dismiss automatically.

Foundation action endpoint returns `501`. Workflow dispatch remains disabled until action runs are
created from tenant-bound rules, approval state is read from durable ledger, and each provider's
ambiguous-retry strategy is implemented.

Related: [data flow](data-flow.md), [Google Tasks](../integrations/google-tasks.md),
[Nextcloud Budget](../integrations/nextcloud-budget.md).
