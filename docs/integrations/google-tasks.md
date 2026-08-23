---
status: accepted
owner: integrations
last_verified: 2026-08-24
sources:
  - https://developers.google.com/workspace/tasks/reference/rest
---

# Google Tasks

Google Tasks is first action provider. Connector authorization is separate and encrypted. Relay
creates a task only from a user-owned action rule with operation `create-task`.

Mapped fields are title, notes, due date, and selected task list. Relay stores Google task ID as
provider reference. Because insert does not offer a Relay-controlled idempotency key, notes carry a
stable Relay action marker and ambiguous retries reconcile the target list before another insert.
Exact marker format and search limitations require implementation validation.

Approval is default. Automatic task creation is enabled per rule only. Deleting or completing tasks
is outside MVP scope.

Related: [action model](../architecture/action-model.md).
