---
name: relay-memory
description: Maintains Relay linked Markdown memory and Graphify sources. Use when architecture, external API assumptions, product scope, or decisions change.
---

# Relay Memory Maintenance

1. Locate canonical record through `docs/memory/index.md`.
2. Update one canonical document; replace duplicated prose elsewhere with links.
3. Record external claims with primary source URLs and verification date.
4. Add ADR for changed decisions. Mark old ADR `superseded` and link replacement.
5. Update issue map when implementation dependencies change.
6. Update `docs/memory/observability.md` and its `last_verified` date when the shared error model,
   logging contract, DEBUG behavior, redaction, correlation, or runtime adapters change.
7. Run Markdown link checks. Graphify is an optional local discovery aid, not a required gate.

Generated `graphify-out` artifacts are disposable. Markdown, contracts, migrations, and ADRs are
memory sources.
