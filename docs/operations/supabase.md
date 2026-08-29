---
status: accepted
owner: maintainers
last_verified: 2026-08-29
---

# Supabase Hosted Runtime Operations

## Environment Contract

Relay intentionally uses one hosted Supabase project under
[ADR-0007](../decisions/0007-shared-hosted-runtime.md). Local Supabase remains resettable test
infrastructure, not a second hosted environment.

| Setting              | Hosted contract                                   |
| -------------------- | ------------------------------------------------- |
| Project name         | `relay-development` (historical name)             |
| Hosted consumer      | Shared Relay runtime                              |
| Region               | `ap-south-1` (Mumbai)                             |
| Plan                 | Free                                              |
| Data                 | Tenant-owned encrypted application data           |
| Schema source        | Reviewed migrations released through `main`       |
| Auth Site URL        | `https://relay.redsteadz.dpdns.org`               |
| Auth web redirect    | `https://relay.redsteadz.dpdns.org/auth/callback` |
| Auth mobile redirect | `com.redsteadz.relay://auth/callback`             |

Project ref remains operator configuration outside Git. Database passwords, access tokens, and secret
keys remain secret. Publishable keys are safe only in matching Relay builds; secret keys are
backend-only. One hosted credential record feeds shared API, Pipeline, and mobile configuration.

## Topology Decision

Issue #9 records organization, region, plan, stable Auth origin, and operator evidence. Issue #63 and
ADR-0007 accept this project as sole hosted database. A future split is not a release gate; it requires
new ADR with measured isolation need and full Auth, data, key, backup, and Queue cutover plan.

## Auth Configuration

`supabase/config.toml` reads exact Site and web redirect URLs from `RELAY_AUTH_SITE_URL` and
`RELAY_AUTH_WEB_REDIRECT_URL` for local stack. Hosted project has one Auth configuration and stable
Relay origin. Configuration always allows reverse-domain mobile callback:

```bash
export RELAY_SUPABASE_PROJECT_REF="<approved-project-ref>"
export RELAY_SUPABASE_ENVIRONMENT="hosted"
export RELAY_AUTH_SITE_URL="https://relay.redsteadz.dpdns.org"
export RELAY_AUTH_WEB_REDIRECT_URL="https://relay.redsteadz.dpdns.org/auth/callback"
test -n "$RELAY_SUPABASE_PROJECT_REF"
export SUPABASE_ACCESS_TOKEN="$(<password-manager-read-supabase-access-token>)"
pnpm supabase:auth:configure
unset SUPABASE_ACCESS_TOKEN RELAY_SUPABASE_PROJECT_REF RELAY_SUPABASE_ENVIRONMENT
unset RELAY_AUTH_SITE_URL RELAY_AUTH_WEB_REDIRECT_URL
```

The configuration command sets `disable_signup=true` and updates only `site_url` and
`uri_allow_list` through the Supabase Auth Management API. It requires HTTPS hosted origins, one exact
`/auth/callback` path on the Site URL's origin, and no wildcard syntax, credentials, query, fragment,
IP address, localhost, or nonstandard port. Hosted validation rejects common development, test,
preview, and ephemeral domains. It verifies signup remains disabled and API response
contains only the requested mobile and web redirects without printing the access token or response.

Inspect Auth URL Configuration after each update and confirm only exact approved destinations exist.
Magic-link code must pass one of these same exact callbacks as `emailRedirectTo`; never rely on an
unreviewed default destination. Relay uses PKCE so the mobile callback receives a one-time code rather
than access and refresh tokens. Automatic account creation remains disabled because enrollment is
operator controlled, independent of deployment topology.

## Initial Migration

Apply hosted project once. CLI may prompt for database password; retrieve it
from the password manager and never place it in command arguments, shell history, logs, or issue
comments. When using an untracked operator environment, name it `SUPABASE_DB_PASSWORD`; the CLI reads
that canonical variable without a `--password` argument. Use `RELAY_SUPABASE_PROJECT_REF` for the
nonsecret project ref and `SUPABASE_ACCESS_TOKEN` only for Management API operations.

```bash
export RELAY_SUPABASE_PROJECT_REF="<hosted-project-ref>"
pnpm exec supabase db push --project-ref "$RELAY_SUPABASE_PROJECT_REF" --dry-run
pnpm exec supabase db push --project-ref "$RELAY_SUPABASE_PROJECT_REF"
pnpm exec supabase migration list --project-ref "$RELAY_SUPABASE_PROJECT_REF"
pnpm exec supabase test db --project-ref "$RELAY_SUPABASE_PROJECT_REF"
unset RELAY_SUPABASE_PROJECT_REF
```

The RLS suite creates two deterministic synthetic tenants inside a transaction, checks every
user-owned table's visibility, exercises every client-writable policy, checks privileged action
decisions, and verifies device registration, revocation, and ingress authorization before rolling
back. Device table writes remain unavailable to authenticated clients; security-definer RPCs derive
ownership exclusively from `auth.uid()`. Record command, migration version, UTC timestamp, operator,
and pass/fail result in issue #9. Never paste connection strings, keys, tokens, test output containing
credentials, or real rows.

Record hosted migration evidence in release issue. Do not apply a second hosted target without a
superseding ADR and reviewed migration plan.

## Generated Types

The canonical API shape is `supabase/database.generated.ts`, generated from a freshly reset local
database rather than mutable hosted project:

```bash
pnpm exec supabase db reset
pnpm supabase:gmail-upgrade:test
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

## Encryption Scope Compatibility

Encrypted `connections`, `source_items`, and recoverable `dead_letter_items` retain
`encryption_environment`. Shared hosted Pipeline always writes `production`; this is stable
compatibility and KEK inventory scope, not second-runtime identity. Local E2E writes `development`
only into resettable local database. Unencrypted, terminal, or retention-purged rows carry no
encryption scope.

Historical ownership migration rejects encrypted rows whose original scope cannot be inferred. Before
key changes, pause canonical Queue consumer and inventory metadata-only counts. Never relabel existing
ciphertext by guess. Run one hosted synthetic ingress canary after deployment.

Only backend secret role can execute KEK inventory and compare-and-set RPCs. Rotation executor sends
encrypted comparison tuples in POST bodies and updates only wrapped data key, wrap nonce, and key
version. Inventory output contains store, environment-scoped key version, and count only.

Only backend secret role can execute encrypted source persistence RPCs. Current generic ingestion calls
`persist_encrypted_source_item_v3`, which validates complete encrypted bundle, authenticated producer,
typed normalization result, fact digest, and original raw expiry. Gmail provider ingestion calls
`persist_encrypted_source_item_v4`; it additionally validates same-tenant active Gmail connection and
connection-bound account ID before delegating to v3 conflict arbitration. A fixed result distinguishes
stored, same-tenant duplicate, and retryable source conflict. Global source-ID collision owned by
another tenant remains an error and cannot acknowledge that tenant's message. Callers never parse or
expose PostgreSQL conflict details. Modern `sb_secret_` keys are sent only as `apikey`; they are not
JWTs and must not appear in an `Authorization` header.

Legacy unversioned and v2 persistence RPCs remain only for reviewed rolling-deployment compatibility;
current Pipeline calls neither. Remove them in later migration after deployed-version rollback and
Queue-drain windows close. Never overload same PostgREST function name with changed arguments.

Only backend secret role can access `dead_letter_items` or execute recovery RPCs. Recording validates
complete encryption tuple, fixed failure code, stable tenant/envelope identity, and expiry exactly
seven days after original acceptance. Atomic replay claim accepts one request UUID, returns ciphertext
only to private Pipeline, and refuses expired or terminal rows. Completion destroys encrypted fields
and writes metadata-only audit. Duplicate Queue completion is idempotent; terminal rows reject later
recording, preventing ciphertext resurrection. Authenticated users have neither table privileges nor
function execution.

## Application Keys

Retrieve the shared project's URL and modern publishable/secret keys through the Dashboard. Provision:

- Hosted public URL and publishable key into API and mobile builds.
- Hosted URL and dedicated secret key into private Pipeline Worker.
- No secret key into Next.js public variables, Expo public variables, mobile artifacts, issue
  comments, CI output, or local tracked files.

Rotate key immediately if it appears in a log or artifact. Run authenticated synthetic canary before
removing previous key.

## Backup And Recovery

Free project has no accepted point-in-time recovery objective. Current recovery uses reviewed
migrations, external key recovery copies, and encrypted logical exports when needed. Issue #45 owns a
tested recovery objective before broader distribution or commitments that require one. Record only
timestamps, backup IDs, operators, and results.

Logical data dumps contain sensitive tenant data. When one is required, write it with owner-only
permissions directly into approved encrypted backup storage, verify restoration, then destroy any
temporary plaintext copy. Database backups do not restore deleted Storage objects; Relay must define
a separate Storage backup before storing user objects there.

## Deletion And Ownership

User deletion is a privileged backend operation that deletes the `auth.users` row; foreign keys then
cascade all Relay-owned rows, including that user's database audit rows. Account deletion requires
authenticated explicit confirmation, records resumable database state, attempts provider cleanup,
finalizes local rows idempotently, and removes Auth identity last. Gmail cleanup first crosses private
Pipeline binding by tenant/connection UUID; API never loads Gmail credential. Provider failure is
counted but cannot strand local deletion. See [privacy lifecycle](../security/privacy.md) for retained
backup/log exceptions and exact tradeoff. Current route relies on verified bearer session plus typed
confirmation. Fresh-auth recency enforcement, non-content completion receipt outside cascading
user-owned tables, and post-delete verification remain release follow-up requirements; stable database
steps and provider requests are already retry-safe.

Project deletion permanently removes all hosted data and backups. Require approved retention check,
verified export or explicit no-backup decision, confirmation from the billing owner and recovery
owner, revocation of application keys, and a recorded project ref before Dashboard deletion. Never
delete hosted project as incident rollback.

Keep at least two organization owners for recovery. Grant daily operators the least role needed;
reserve Owner or Administrator for billing, Auth configuration, project recovery, and destructive
changes. Review members quarterly and immediately remove departed operators.

## Sources

- [Managing Supabase environments](https://supabase.com/docs/guides/deployment/managing-environments)
- [Generating TypeScript types](https://supabase.com/docs/guides/api/rest/generating-types)
- [Auth redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls)
- [Native mobile deep linking](https://supabase.com/docs/guides/auth/native-mobile-deep-linking)
- [Passwordless email and PKCE](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Update Auth service config](https://supabase.com/docs/reference/api/v1-update-auth-service-config)
- [Database backups](https://supabase.com/docs/guides/platform/backups)
- [Database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase access control](https://supabase.com/docs/guides/platform/access-control)

Related: [privacy](../security/privacy.md), [system architecture](../architecture/system.md),
[Cloudflare operations](cloudflare.md),
[ADR-0007](../decisions/0007-shared-hosted-runtime.md), and
[database instructions](../../supabase/AGENTS.md).
