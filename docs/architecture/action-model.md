---
status: accepted
owner: architecture
last_verified: 2026-09-07
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

## The Ledger

`action_runs` is the durable record that a rule proposed one provider action for one event, and what
the tenant decided. Nothing writes it directly: `insert`, `update`, and `delete` are revoked from
both `authenticated` and `service_role`, so every change goes through a routine that validates the
transition and records it.

### Identity

A run's id is not assigned, it is derived. `relay_action_run_id` is the UUIDv5 of
`<action rule>\x00<event>` under a fixed namespace, and a check constraint requires every row's id to
equal that derivation, so a run whose identity was chosen rather than derived cannot exist.

Two consequences follow. A repeated proposal for the same rule and event computes the same id and
converges on the row that already exists, so a redelivered message cannot create a second action or a
second audit record. And a provider idempotency key derived from the id is stable before the row is
written, which is what the provider issues need. `relayActionRunId` in `packages/domain` mirrors the
derivation for callers; the database function stays the authority, and both suites assert the same
vector so they cannot drift apart.

### Tenant and provider binding

Composite foreign keys carry `user_id` through every edge: a run to its rule and event, a rule to its
filter rule and connection. Binding a run to another tenant's rule or event is a referential error
rather than a policy question.

Provider is bound the same way. `action_runs` references `action_rules (user_id, id, provider)`, so a
run's provider is a fact about its rule instead of an independently written column, and the two
cannot disagree.

### Proposal

`propose_action_run_v1` is service-role only and takes a tenant, a rule, an event, and rendered
input. It takes no provider, operation, connection, status, or approval mode: those are read from the
persisted rule, so nothing derived from source content or a model can select them. Input is rejected
if it carries `action`, `provider`, `operation`, `endpoint`, or `credential` at any depth, reusing the
same guard the filter compiler applies to plans.

Only an enabled rule may propose. Connection removal detaches and disables a rule in one statement,
so a rule whose credential is gone cannot propose either. A category-gated action rule (whose underlying
filter rule specifies a category) requires a current classification with `origin = 'server'` on the
event's source item. A device-authored classification (`origin = 'device'`) or absent classification
refuses proposal (ADR-0014). The rule's `approval_mode` decides the starting state -- `required` yields
`awaiting-approval`, `automatic` yields `approved` with a timestamp -- and the mode in force is copied
onto the run, so the ledger still explains an automatic approval after the rule is edited.

### Decision

`decide_action_run` is the only path for a tenant, runs as the authenticated user, and holds a row
lock while it decides:

| From                                          | `approve`  | `cancel`    |
| --------------------------------------------- | ---------- | ----------- |
| `proposed`                                    | refused    | `cancelled` |
| `awaiting-approval`                           | `approved` | `cancelled` |
| `approved`                                    | refused    | `cancelled` |
| `running`, `succeeded`, `failed`, `cancelled` | refused    | refused     |

Approval re-reads the rule, because an approval can be attempted after the rule was disabled. A
second concurrent approval observes committed state and is refused rather than re-approving. Both
outcomes write a metadata-only audit row naming the transition performed.

### Workflow eligibility

`claim_action_run_for_workflow_v1` is the single gate between ledger state and an external effect. It
is service-role only, moves `approved` to `running` under a row lock, and re-checks that the rule is
still enabled, so an approval that predates a rule being turned off cannot start anything. For category-gated
action rules, it re-verifies that the source item retains a current server classification (`origin = 'server'`). Only
`approved` is eligible: an undecided run, one already running, and every terminal state are refused.

A repeated claim from the same workflow instance returns the running row without starting a second
attempt, so a lost response converges. A different instance claiming a running row is a conflict.
Dispatch itself is still unimplemented; this is the gate it will have to pass through.

Notification dismissal is separate from provider action approval. It requires explicit source and
filter scope, deterministic match, confidence policy, completed dry run, and audit record. AI-only
matches cannot dismiss automatically.

Workflow dispatch remains disabled. Of the three conditions it waits on, two now hold: action runs
are created from tenant-bound rules, and approval state is read from the durable ledger above. The
third -- each provider's ambiguous-retry strategy -- is still outstanding, so
`dispatchProvider` continues to report `not-configured` rather than pretending an effect occurred.

There is no HTTP action endpoint. Tenants decide through `decide_action_run` directly, as the
authenticated Supabase role, so approval never passes through a service that could substitute its
own tenant identity.

Related: [data flow](data-flow.md), [Google Tasks](../integrations/google-tasks.md),
[Nextcloud Budget](../integrations/nextcloud-budget.md).

## Classification Origin And Dispatch

A classification records who decided it. `origin = 'device'` means a client evaluated deterministic
rules against what it could read; `origin = 'server'` means the pipeline decided with the raw payload
available. See [ADR-0014](../decisions/0014-device-local-classification.md).

**A device-authored classification must never gate a provider effect.** When category begins to
select an action rule, dispatch must require `origin = 'server'`. Nothing dispatches on category
today, so this is a constraint on the dispatch path being built rather than a check that exists in
code.
