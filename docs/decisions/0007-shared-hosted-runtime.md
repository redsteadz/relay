---
status: accepted
date: 2026-08-26
owners: maintainers
supersedes:
  - 0006-shared-supabase-hackathon-backend
  - 0005-versioned-wrapping-keys (per-environment topology only)
---

# ADR-0007: Shared Hosted Runtime

## Context

Relay has one maintainer, one early application deployment, and no operational need for duplicate
hosted infrastructure. Separate development and production Workers, Queues, Durable Objects,
Workflows, keyrings, and future Supabase projects add deployment and recovery paths without reducing a
current measured risk. Branch promotion and local verification already provide change control.

## Decision

Relay uses one hosted runtime until measured scale, compliance, recovery, or risk requirements justify
isolation. Existing production-suffixed Cloudflare resources become canonical to preserve Queue,
Durable Object, custom-domain, secret, and deployment state:

- `relay-api-production` is the only hosted API Worker.
- `relay-pipeline-production` is the only hosted Pipeline Worker.
- `relay-ingress-production` and its dead-letter Queue are the only hosted asynchronous resources.
- No Action Workflow is provisioned until a persisted action dispatch path exists; issue #35 owns
  that implementation.
- `relay-development` remains the one hosted Supabase project despite its historical name.
- One hosted publishable-key record, backend secret set, ingress secret, and KEK keyring serve the
  runtime.

Only reviewed `main` deploys remotely. `dev` remains the protected integration branch and validates
through CI, local Supabase, local Wrangler, and synthetic fixtures. Branch separation does not imply
deployment separation.

The deployed database contract retains `encryption_environment='production'` and environment-scoped
rotation RPCs. That value is now a stable compatibility and KEK inventory scope, not a claim that a
second runtime exists. Local E2E may continue using `development` in its resettable database.

Account enrollment remains operator controlled. This is an access-policy decision independent of
infrastructure topology. Exact hosted Auth callbacks, RLS, encryption, seven-day raw retention,
tenant-bound operations, and no-plaintext logging remain mandatory.

## Consequences

One migration, quota event, secret rotation, deployment, operator mistake, or provider outage can
affect all hosted use. There is one backup and recovery boundary. These risks are accepted for current
stage because duplicate infrastructure would increase operational complexity more than resilience.

Remote releases are simpler: promote `dev` to `main`, deploy Pipeline when it changed, deploy API, and
run one authenticated synthetic canary. Local and CI validation must pass before release because no
hosted development runtime exists.

Future separation requires a new ADR with a concrete trigger and cutover plan. Valid triggers include
contractual or regulatory isolation, multiple deployment operators, incompatible release cadences,
material quota contention, tested recovery objectives requiring independent failure domains, or usage
where shared-runtime blast radius exceeds accepted risk. A split must inventory and migrate Queue,
Durable Object, any implemented Workflow, KEK, Auth, and database state rather than create empty
parallel resources.

Related: [Cloudflare operations](../operations/cloudflare.md),
[Supabase operations](../operations/supabase.md),
[ADR-0004](0004-development-release-branches.md), and
[ADR-0005](0005-versioned-wrapping-keys.md).

## Sources

- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Supabase environment guidance](https://supabase.com/docs/guides/deployment/managing-environments)
- [Cloudflare Queues](https://developers.cloudflare.com/queues/)
