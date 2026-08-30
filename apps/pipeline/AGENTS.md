# Pipeline Instructions

- Assume Queue delivery and HTTP provider calls can repeat.
- Persist idempotency state before external effects whenever provider semantics permit.
- Durable Objects serialize per-user/source work; Supabase remains durable record.
- Workflow steps must be independently retry-safe.
- Store approvals and action state before starting or resuming a provider Workflow.
- Never place credentials or raw source content in Workflow IDs, logs, or error messages.
- Preserve exact decimal strings for money. Never convert currency amounts through JavaScript float.
- Dead-letter handling must retain metadata and encrypted references, not plaintext bodies.
- Use `src/observability.ts` for terminal Queue, Workflow, Durable Object, database, and provider
  failures. Preserve causes, propagate request IDs, and do not double-log retries or rethrows.

Canonical context: [data flow](../../docs/architecture/data-flow.md) and
[action model](../../docs/architecture/action-model.md). Error handling must follow the canonical
[observability guide](../../docs/memory/observability.md).
