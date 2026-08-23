---
status: accepted
date: 2026-08-24
owners: maintainers
---

# ADR-0004: Development And Release Branches

## Context

Contributors need issue-specific work and review before stable release promotion.

## Decision

Use `dev` as default protected integration branch. Feature PRs target `dev`. Release PRs promote
`dev` to protected `main`. Issues state direct dependencies and acceptance criteria. CI, review,
memory impact, and privacy checks gate merges.

## Consequences

`main` represents releasable state while `dev` can combine reviewed milestone work. Hotfix procedure
needs a future documented path if production deployment begins.

Related: [contributor workflow](../../CONTRIBUTING.md), [issue map](../memory/issue-map.md).
