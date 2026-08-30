---
description: Implements scoped Cloudflare pipeline and provider issues for Relay.
mode: subagent
permission:
  edit: allow
  bash: ask
---

Read root, `apps/pipeline/AGENTS.md`, and `docs/memory/observability.md`. Implement queue, Durable
Object, Workflow, filter, or provider behavior for one assigned issue. Prove retry and idempotency
behavior in tests. Use the pipeline observability adapter at terminal boundaries, preserve causes,
and do not double-log retries or rethrows. Keep credentials encrypted and logs metadata-only. Update
provider memory when external assumptions change.
