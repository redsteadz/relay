---
status: accepted
owner: maintainers
last_verified: 2026-08-24
---

# Supabase Environments And Operations

## Environment Contract

Relay uses independent Supabase projects rather than branches of one project. This keeps database,
Auth users, API keys, backups, quotas, and destructive operations isolated.

| Setting              | Development                           | Production                            |
| -------------------- | ------------------------------------- | ------------------------------------- |
| Project name         | `relay-development`                   | `relay-production`                    |
| Database             | Development-only project              | Production-only project               |
| Region               | `ap-south-1` (Mumbai)                 | Not provisioned                       |
| API keys             | Development-only key set              | Production-only key set               |
| Data                 | Synthetic fixtures only               | Consented user data                   |
| Schema source        | Migrations merged into `dev`          | Migrations released to `main`         |
| Auth mobile redirect | `com.redsteadz.relay://auth/callback` | `com.redsteadz.relay://auth/callback` |
| Auth web redirect    | Exact approved development URL        | Exact approved HTTPS production URL   |

Project refs remain deployment configuration outside Git to prevent cross-environment mistakes.
Database passwords, access tokens, and service-role keys remain secret. Public client keys are
environment-specific even though they are safe to embed in the matching application build.
Service-role keys are backend-only: development and production Pipeline Workers receive only their
matching URL and key.

## Decision Gate

Before project creation, record these nonsecret decisions in issue #9:

1. Supabase organization and billing owner.
2. Region selected for both projects based on approved data residency and primary users.
3. Plan, compute size, backup retention, and production recovery point objective.
4. Exact development and production web Auth URLs.
5. Primary operator and recovery owner.

Do not reuse an existing unrelated project. Do not create either project until organization, region,
and billing impact are approved. Create `relay-development` first through the Supabase Dashboard,
then create `relay-production` with a different generated database password. Store both passwords
and all API keys under separate environment records in the approved password manager.

## Auth Configuration

`supabase/config.toml` reads exact Site and web redirect URLs from `RELAY_AUTH_SITE_URL` and
`RELAY_AUTH_WEB_REDIRECT_URL` for the local stack. Hosted configuration uses the same variables and
always allows the reverse-domain mobile callback `com.redsteadz.relay://auth/callback`. Before
updating hosted configuration, load one environment's nonsecret URL values and project ref without
loading values from the other environment:

```bash
export RELAY_SUPABASE_PROJECT_REF="<approved-project-ref>"
export RELAY_SUPABASE_ENVIRONMENT="<development-or-production>"
export RELAY_AUTH_SITE_URL="<exact-site-url>"
export RELAY_AUTH_WEB_REDIRECT_URL="<exact-web-auth-callback>"
test -n "$RELAY_SUPABASE_PROJECT_REF"
export SUPABASE_ACCESS_TOKEN="$(<password-manager-read-supabase-access-token>)"
pnpm supabase:auth:configure
unset SUPABASE_ACCESS_TOKEN RELAY_SUPABASE_PROJECT_REF RELAY_SUPABASE_ENVIRONMENT
unset RELAY_AUTH_SITE_URL RELAY_AUTH_WEB_REDIRECT_URL
```

The configuration command updates only `site_url` and `uri_allow_list` through the Supabase Auth
Management API. It requires HTTPS hosted origins, one exact `/auth/callback` path on the Site URL's
origin, and no wildcard syntax, credentials, query, fragment, IP address, localhost, or nonstandard
port. Production additionally rejects common development, test, preview, and ephemeral hosting
domains. It verifies the API response contains only the requested mobile and web redirects without
printing the access token or response.

Inspect Auth URL Configuration after each update and confirm only exact approved destinations exist.
Magic-link code must pass one of these same exact callbacks as `emailRedirectTo`; never rely on an
unreviewed default destination.

## Initial Migration

Apply development first. The CLI may prompt for the environment's database password; retrieve it
from the password manager and never place it in command arguments, shell history, logs, or issue
comments. When using an untracked operator environment, name it `SUPABASE_DB_PASSWORD`; the CLI reads
that canonical variable without a `--password` argument. Use `RELAY_SUPABASE_PROJECT_REF` for the
nonsecret project ref and `SUPABASE_ACCESS_TOKEN` only for Management API operations.

```bash
export RELAY_SUPABASE_PROJECT_REF="<development-project-ref>"
pnpm exec supabase db push --project-ref "$RELAY_SUPABASE_PROJECT_REF" --dry-run
pnpm exec supabase db push --project-ref "$RELAY_SUPABASE_PROJECT_REF"
pnpm exec supabase migration list --project-ref "$RELAY_SUPABASE_PROJECT_REF"
pnpm exec supabase test db --project-ref "$RELAY_SUPABASE_PROJECT_REF"
unset RELAY_SUPABASE_PROJECT_REF
```

The RLS suite creates two deterministic synthetic tenants inside a transaction, checks every
user-owned table's visibility, exercises every client-writable policy, checks privileged action
decisions, then rolls back. Record command, migration version, UTC timestamp, operator, and pass/fail
result in issue #9. Never paste connection strings, keys, tokens, test output containing credentials,
or real rows.

After development evidence passes and the same migration commit reaches `main`, repeat the dry-run,
push, migration list, and RLS test against production. Stop on any unexpected migration or policy
difference. No source data may enter production before the production RLS result passes.

## Generated Types

The canonical API shape is `supabase/database.generated.ts`, generated from a freshly reset local
database rather than either mutable hosted project:

```bash
pnpm exec supabase db reset
pnpm supabase:types
pnpm supabase:types:check
```

CI regenerates and compares this file after migrations and RLS tests. After each hosted migration,
also compare that project's public schema to the committed artifact:

```bash
pnpm supabase:types:remote:check
```

Hosted generation includes a PostgREST version hint that local generation omits; the check removes
only that provider metadata before comparison. Any remaining difference blocks deployment. Fix
migrations or regenerate locally; never edit generated output by hand.

## Application Keys

After both projects exist, retrieve each project's URL and API keys through the Dashboard. Verify the
development and production URLs and key values differ without printing them. Provision:

- Matching public URL and publishable or legacy anon key into each API build and mobile build.
- Matching URL and service-role key into each private Pipeline Worker.
- No service-role key into Next.js public variables, Expo public variables, mobile artifacts, issue
  comments, CI output, or local tracked files.

Rotate a key immediately if it appears in a log or artifact. Update one environment at a time and run
an authenticated synthetic canary before removing its previous key.

## Backup And Recovery

Production plan selection must meet the recorded recovery objective. Supabase documents daily
backups for paid plans and recommends regular off-site logical exports for free projects. Before
accepting source data, verify the production Backups page shows the expected policy and perform a
restore drill into a temporary isolated project with synthetic data. Record only timestamps, backup
IDs, operators, and results.

Logical data dumps contain sensitive tenant data. When one is required, write it with owner-only
permissions directly into approved encrypted backup storage, verify restoration, then destroy any
temporary plaintext copy. Database backups do not restore deleted Storage objects; Relay must define
a separate Storage backup before storing user objects there.

## Deletion And Ownership

User deletion is a privileged backend operation that deletes the `auth.users` row; foreign keys then
cascade all Relay-owned rows, including that user's database audit rows. Require fresh
authentication, stable request idempotency, a non-content deletion receipt outside user-owned
tables, and post-delete verification. This capability remains disabled until its dedicated
access-control implementation and tests exist.

Project deletion permanently removes data and hosted backups. Require an approved retention check,
verified export or explicit no-backup decision, confirmation from the billing owner and recovery
owner, revocation of application keys, and a recorded project ref before Dashboard deletion. Never
delete production as an incident rollback.

Keep at least two organization owners for recovery. Grant daily operators the least role needed;
reserve Owner or Administrator for billing, Auth configuration, project recovery, and destructive
changes. Review members quarterly and immediately remove departed operators.

## Sources

- [Managing Supabase environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Generating TypeScript types](https://supabase.com/docs/guides/api/rest/generating-types)
- [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Native mobile deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
- [Update Auth service config](https://supabase.com/docs/reference/api/v1-update-auth-service-config)
- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase access control](https://supabase.com/docs/guides/platform/access-control)

Related: [privacy](../security/privacy.md), [system architecture](../architecture/system.md),
[Cloudflare operations](cloudflare.md), and [database instructions](../../supabase/AGENTS.md).
