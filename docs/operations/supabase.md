---
status: accepted
owner: maintainers
last_verified: 2026-08-25
---

# Supabase Environments And Operations

## Environment Contract

Relay temporarily uses one Supabase project for both hosted hackathon deployments. This exception is
accepted only under [ADR-0006](../decisions/0006-shared-supabase-hackathon-backend.md).

| Setting              | Shared hackathon contract                                 |
| -------------------- | --------------------------------------------------------- |
| Project name         | `relay-development`                                       |
| Hosted consumers     | Cloudflare development and demo-production                |
| Region               | `ap-south-1` (Mumbai)                                     |
| Plan                 | Free                                                      |
| Data                 | Deterministic synthetic fixtures only                     |
| Schema source        | Reviewed migrations merged into `dev`                     |
| Auth Site URL        | `https://relay.redsteadz.dpdns.org`                       |
| Auth web redirect    | `https://relay.redsteadz.dpdns.org/auth/callback`         |
| Auth mobile redirect | `com.redsteadz.relay://auth/callback`                     |
| Isolation gate       | Issue [#63](https://github.com/redsteadz/relay/issues/63) |

The shared project ref remains deployment configuration outside Git to prevent accidental coupling
in runtime code. Database passwords, access tokens, and secret keys remain secret. Public client keys
are safe to embed only in matching Relay builds. Secret keys are backend-only. Enter shared values
independently into each Cloudflare environment so issue #63 can replace production without changing
the development record.

## Decision Gate

Issue #9 records the organization, region, Free plan, stable Auth origin, operator evidence, and
synthetic-only approval for the shared project. Do not reuse any other existing project.

Before beta access or real data, issue #63 must create `relay-production` with a different project
ref, database password, database, and API key set. It must also approve billing, region, backup
retention, recovery objective, primary operator, and recovery owner. Store development and production
credentials under separate environment records in the approved password manager.

## Auth Configuration

`supabase/config.toml` reads exact Site and web redirect URLs from `RELAY_AUTH_SITE_URL` and
`RELAY_AUTH_WEB_REDIRECT_URL` for the local stack. The shared hosted project has one Auth
configuration, so both hackathon deployments use the stable Relay origin. Hosted configuration
always allows the reverse-domain mobile callback `com.redsteadz.relay://auth/callback`:

```bash
export RELAY_SUPABASE_PROJECT_REF="<approved-project-ref>"
export RELAY_SUPABASE_ENVIRONMENT="production"
export RELAY_AUTH_SITE_URL="https://relay.redsteadz.dpdns.org"
export RELAY_AUTH_WEB_REDIRECT_URL="https://relay.redsteadz.dpdns.org/auth/callback"
test -n "$RELAY_SUPABASE_PROJECT_REF"
export SUPABASE_ACCESS_TOKEN="$(<password-manager-read-supabase-access-token>)"
pnpm supabase:auth:configure
unset SUPABASE_ACCESS_TOKEN RELAY_SUPABASE_PROJECT_REF RELAY_SUPABASE_ENVIRONMENT
unset RELAY_AUTH_SITE_URL RELAY_AUTH_WEB_REDIRECT_URL
```

The configuration command updates only `site_url` and `uri_allow_list` through the Supabase Auth
Management API. It requires HTTPS hosted origins, one exact `/auth/callback` path on the Site URL's
origin, and no wildcard syntax, credentials, query, fragment, IP address, localhost, or nonstandard
port. Production validation rejects common development, test, preview, and ephemeral hosting domains.
It verifies the API response contains only the requested mobile and web redirects without printing
the access token or response.

Inspect Auth URL Configuration after each update and confirm only exact approved destinations exist.
Magic-link code must pass one of these same exact callbacks as `emailRedirectTo`; never rely on an
unreviewed default destination.

## Initial Migration

Apply the shared hosted project once. The CLI may prompt for the database password; retrieve it
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

Record shared-project evidence in issue #9. Do not apply a second hosted target during the hackathon.
Issue #63 repeats the dry-run, push, migration list, RLS test, and type comparison against isolated
production before any real source data is allowed.

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

## Encryption Environment Ownership

While ADR-0006 shares one project, encrypted `connections` and encrypted `source_items` carry the
Cloudflare environment that owns their KEK. The pipeline filters every rotation inventory and write by
that value. Unencrypted or retention-purged source rows carry no encryption environment.

The ownership migration rejects existing encrypted rows because their environment cannot be inferred
safely. Before applying it, pause both Queue consumers and run metadata-only counts for connections
and encrypted source items. Delete only confirmed synthetic fixtures or defer migration; never guess
ownership. Apply the reviewed migration, deploy both pipeline environments, then resume consumers and
run one synthetic ingress canary per environment.

Only `service_role` can execute KEK inventory and compare-and-set RPCs. The rotation executor sends
encrypted comparison tuples in POST bodies and updates only wrapped data key, wrap nonce, and key
version. Inventory output contains store, environment-scoped key version, and count only.

## Application Keys

Retrieve the shared project's URL and modern publishable/secret keys through the Dashboard. Provision:

- Shared public URL and publishable key into each hackathon API build and mobile build.
- Shared URL and secret key into each private Pipeline Worker as separately managed environment
  entries.
- No secret key into Next.js public variables, Expo public variables, mobile artifacts, issue
  comments, CI output, or local tracked files.

The values temporarily match across hosted environments; issue #63 must make production values
distinct. Rotate a key immediately if it appears in a log or artifact. Update one environment entry
at a time and run an authenticated synthetic canary before removing its previous key.

## Backup And Recovery

The shared Free project is not an accepted production backup target. Keep only reproducible synthetic
fixtures and use encrypted off-site logical exports when hackathon recovery evidence is needed.
Issue #63 must select a production plan that meets its recorded recovery objective, verify the
Backups page, and perform a synthetic restore drill before real source data is accepted. Record only
timestamps, backup IDs, operators, and results.

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
- [Database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase access control](https://supabase.com/docs/guides/platform/access-control)

Related: [privacy](../security/privacy.md), [system architecture](../architecture/system.md),
[Cloudflare operations](cloudflare.md),
[ADR-0006](../decisions/0006-shared-supabase-hackathon-backend.md), and
[database instructions](../../supabase/AGENTS.md).
