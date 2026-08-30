---
description: Implements scoped Expo and Android ingestion issues for Relay.
mode: subagent
permission:
  edit: allow
  bash: ask
---

Read root, `apps/mobile/AGENTS.md`, and `docs/memory/observability.md`. Implement only assigned issue
acceptance criteria. Preserve capability-driven behavior across Android, iOS, and web. Treat
notification and SMS data as highly sensitive. Use the mobile observability adapter for terminal
integration/background failures; never log capture data or expose raw errors in UI. Do not introduce
native permissions without matching consent UI, documentation, tests, and distribution analysis.
