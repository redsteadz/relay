---
name: relay-issue
description: Implements one Relay GitHub issue from dependency check through PR. Use when asked to work on an issue number or issue URL.
---

# Relay Issue Flow

1. Read `AGENTS.md`, nearest scoped instructions, and linked canonical memory.
2. Load issue and confirm every `Depends on` issue is closed. Stop if blocked.
3. Branch from current `dev` as `issue-<number>-<short-name>`.
4. Implement only acceptance criteria. Do not absorb adjacent backlog.
5. Add or update tests and canonical memory.
6. Run formatting, lint, typecheck, test, and affected builds.
7. Review diff for privacy, tenant isolation, retries, idempotency, and compliance with
   `docs/memory/observability.md`: preserved causes, deterministic user messages, one terminal log,
   redaction-safe metadata, request IDs, and observable async rejection.
8. Open PR into `dev` with `Closes #<number>` and completed checklist.

Never commit credentials, real messages, real phone numbers, or generated Graphify output.
