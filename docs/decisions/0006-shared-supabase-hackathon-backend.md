---
status: accepted
date: 2026-08-25
owners: maintainers
---

# ADR-0006: Shared Supabase Hackathon Backend

## Context

Relay's intended deployment isolates development and production databases, Auth users, API keys,
quotas, backups, and destructive operations. The Supabase organization has no remaining Free-project
capacity, while the existing `relay-development` project already has the initial migration, remote
two-user RLS evidence, generated-type comparison, and synthetic canaries. The hackathon demo needs a
stable hosted backend without adding a paid project.

## Decision

Until issue [#63](https://github.com/redsteadz/relay/issues/63) closes, Cloudflare development and
demo-production deployments use the same `relay-development` Supabase project in `ap-south-1` on the
Free plan.

The exception has these hard limits:

- Both deployments accept deterministic synthetic fixtures and dedicated test accounts containing
  synthetic content only. Real messages, notifications, SMS, email, and credentials granting access
  to real sources are prohibited.
- Hosted Auth uses `https://relay.redsteadz.dpdns.org` as its one Site URL and
  `https://relay.redsteadz.dpdns.org/auth/callback` plus the mobile deep link as exact redirects.
- Shared Supabase values are still entered independently into each Cloudflare environment. Runtime
  code must not infer an environment from the Supabase project name or key.
- Local Supabase remains the resettable test database. Hosted schema changes still come only from
  reviewed migrations.
- Issue #63 is a release gate before beta access, non-maintainer accounts, production source
  persistence, or any real source data. It creates an isolated production project and supersedes
  this exception.

## Consequences

Development and demo-production have no database, Auth-user, API-key, quota, backup, or failure
isolation during the hackathon. A migration, key change, Auth change, quota event, or destructive
operation affects both deployments. The shared Free project provides no accepted production backup
or recovery guarantee. These risks are acceptable only because the data boundary is synthetic and
temporary.

The one hosted Auth configuration cannot carry separate development and production Site URLs. Both
hosted deployments therefore use the stable Relay origin; localhost remains confined to the local
Supabase stack.

Related: [Supabase operations](../operations/supabase.md),
[privacy lifecycle](../security/privacy.md), and
[ADR-0002](0002-cloudflare-processing-boundary.md).

## Sources

- [Supabase environment guidance](https://supabase.com/docs/guides/deployment/managing-environments)
- [Supabase pricing](https://supabase.com/pricing)
- [Supabase Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
