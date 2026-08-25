---
status: accepted
owner: maintainers
last_verified: 2026-08-25
---

# Cloudflare Environments And Operations

## Resource Contract

Relay uses one Cloudflare account with isolated development and production resources. Wrangler adds
the environment suffix to each Worker name. Bindings and variables are repeated explicitly because
Wrangler does not inherit them into environments.

| Resource             | Development                             | Production                                |
| -------------------- | --------------------------------------- | ----------------------------------------- |
| API Worker           | `relay-api-development`                 | `relay-api-production`                    |
| Pipeline Worker      | `relay-pipeline-development`            | `relay-pipeline-production`               |
| Ingress Queue        | `relay-ingress-development`             | `relay-ingress-production`                |
| Dead-letter Queue    | `relay-ingress-dead-letter-development` | `relay-ingress-dead-letter-production`    |
| Action Workflow      | `relay-action-workflow-development`     | `relay-action-workflow-production`        |
| Tenant coordinator   | `TENANT_COORDINATOR` SQLite DO binding  | `TENANT_COORDINATOR` SQLite DO binding    |
| Retention cron       | Hourly at minute 17                     | Hourly at minute 17                       |
| API to pipeline call | `PIPELINE` service binding              | `PIPELINE` service binding                |
| Public API endpoint  | Environment-specific `workers.dev` URL  | `relay.redsteadz.dpdns.org` custom domain |

Pipeline Workers disable `workers.dev` and preview URLs and declare no routes. Only Queue, cron, and
explicit service-binding invocations can reach them. The development API uses its environment-specific
`workers.dev` URL. The production API disables `workers.dev` and uses the approved
`relay.redsteadz.dpdns.org` custom domain, which is also the canonical hosted Auth origin.

Ingress and dead-letter Queue messages use 24-hour retention at provisioning time. Cloudflare fixes
Free-plan retention at 24 hours. A failed ingress message can spend one retention period in ingress
and another after transfer to the dead-letter Queue, so old-KEK retirement requires a 48-hour wait
plus empty-backlog verification when operators do not drain both Queues.

## Ownership

Maintainers own both environments. Production changes require a reviewed `dev` to `main` release and
a named operator. Store Cloudflare account IDs and tokens in operator or CI secret stores, not this
repository. Resource names contain environment and function only, never tenant IDs, provider
accounts, credentials, or source content.

## First Provisioning

Confirm the target Cloudflare account and plan before creating resources. Create Queues first:

```bash
pnpm --filter @relay/pipeline exec wrangler queues create relay-ingress-development --message-retention-period-secs 86400
pnpm --filter @relay/pipeline exec wrangler queues create relay-ingress-dead-letter-development --message-retention-period-secs 86400
pnpm --filter @relay/pipeline exec wrangler queues create relay-ingress-production --message-retention-period-secs 86400
pnpm --filter @relay/pipeline exec wrangler queues create relay-ingress-dead-letter-production --message-retention-period-secs 86400
```

Provision environment-specific secrets from [the key runbook](../security/key-rotation.md) and
Supabase values from issue #9. Wrangler declares required secret names without values and blocks an
incomplete deployment. For first deployment, export separate API and pipeline JSON secret files into
a random owner-only directory. Keep them outside the repository and delete them immediately after
deployment. Never print their contents:

```bash
umask 077
SECRET_DIR="$(mktemp -d)"
trap 'rm -rf -- "$SECRET_DIR"' EXIT
test "$(stat -c %a "$SECRET_DIR")" = "700"
<password-manager-export-pipeline-development> > "$SECRET_DIR/pipeline-development.json"
<password-manager-export-api-development> > "$SECRET_DIR/api-development.json"
<password-manager-export-pipeline-production> > "$SECRET_DIR/pipeline-production.json"
<password-manager-export-api-production> > "$SECRET_DIR/api-production.json"
```

API builds require nonempty environment-specific `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` values from issue #9. Next.js freezes these values during each build,
so load and validate development values immediately before development deployment:

```bash
export NEXT_PUBLIC_SUPABASE_URL="$(<password-manager-read-development-supabase-url>)"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(<password-manager-read-development-supabase-anon-key>)"
test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
pnpm --filter @relay/pipeline exec wrangler deploy --env development --secrets-file "$SECRET_DIR/pipeline-development.json"
pnpm --filter @relay/api deploy:development -- --secrets-file "$SECRET_DIR/api-development.json"
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Load production values separately and deploy production only from the reviewed `main` release:

```bash
export NEXT_PUBLIC_SUPABASE_URL="$(<password-manager-read-production-supabase-url>)"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(<password-manager-read-production-supabase-anon-key>)"
test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
pnpm --filter @relay/pipeline exec wrangler deploy --env production --secrets-file "$SECRET_DIR/pipeline-production.json"
pnpm --filter @relay/api deploy:production -- --secrets-file "$SECRET_DIR/api-production.json"
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
rm -rf -- "$SECRET_DIR"
trap - EXIT
```

Issue #7 operator creates resources and executes first deployment; issue #6 owner supplies approved
secret material and records nonsecret provisioning evidence. Close #7 after resource verification,
then #6 verifies platform ownership, migration canaries, and rotation readiness. Never use top-level
deploy commands for remote environments. `--env development` and `--env production` are mandatory.

## Verification

1. Run `wrangler queues list` and verify all four names. The list command omits retention; inspect each
   Queue's `message_retention_period` through Cloudflare API or dashboard and run the idempotent update
   command when it differs:

   ```bash
   pnpm --filter @relay/pipeline exec wrangler queues update <queue-name> --message-retention-period-secs 86400
   ```

2. Run `wrangler deployments list --env <environment>` in both app directories.
3. Run `wrangler workflows list` and verify both action workflows.
4. Confirm pipeline deployment output shows Queue, Workflow, SQLite Durable Object, and hourly cron
   bindings.
5. Confirm pipeline has no public URL, route, or preview URL. Confirm API output binds `PIPELINE` to
   the same environment suffix.
6. Trigger synthetic authenticated ingress only after Supabase and issue #6 secrets are provisioned.
   Verify Queue acknowledgement follows durable persistence and logs contain metadata only.
7. Test the scheduled handler locally after loading synthetic development configuration. Run
   Wrangler in one terminal:

   ```bash
   pnpm --filter @relay/pipeline exec wrangler dev --env development --test-scheduled
   ```

   Call the scheduled route from a second terminal:

   ```bash
   curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=17+*+*+*+*"
   ```

   After remote deployment, verify cron `17 * * * *` and a successful invocation in Cron Events.
   Confirm cleanup logs contain no row contents.

Record nonsecret resource names, deployment version IDs, timestamps, and operator in issue #7.

## Local End-To-End Verification

Run the complete synthetic ingress path with one command from the repository root:

```bash
npx pnpm@11.23.0 e2e:local
```

Docker must be running. The harness starts local Supabase when needed, resets and seeds it, builds
shared packages, and launches API plus Wrangler with `--env e2e --local`. Explicit
`RELAY_PIPELINE_URL` routing takes precedence over Cloudflare service bindings only outside
production. The harness uses temporary random secrets, rejects non-loopback Supabase status, removes
temporary Worker state, and stops Supabase only when it started the stack. No Cloudflare login,
remote Queue, remote Worker, or hosted Supabase project participates.

## Rollback

List deployments, select a known-good version, and record the reason:

```bash
pnpm --filter @relay/api exec wrangler deployments list --env <environment>
pnpm --filter @relay/api exec wrangler rollback <version-id> --env <environment> --message "rollback reason"
pnpm --filter @relay/pipeline exec wrangler deployments list --env <environment>
pnpm --filter @relay/pipeline exec wrangler rollback <version-id> --env <environment> --message "rollback reason"
```

Roll back the API caller before the pipeline target when both changed. Worker rollback does not roll
back bindings or Durable Object storage. A target version from before the latest `exports` lifecycle
change is ineligible; forward-deploy compatible code retaining current `exports` instead. Never
delete Queues, Workflow, or Durable Object resources during incident rollback. Retain the highest
activated KEK version even when code rolls back.

## Sources

- [Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Queue limits and retention](https://developers.cloudflare.com/queues/platform/limits/)
- [Queue configuration](https://developers.cloudflare.com/queues/configuration/configure-queues/)
- [Cron triggers and local testing](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Durable Object class exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Cloudflare Workflows](https://developers.cloudflare.com/workflows/)
- [OpenNext Cloudflare CLI](https://opennext.js.org/cloudflare/cli)
- [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

Related: [Cloudflare processing boundary](../decisions/0002-cloudflare-processing-boundary.md),
[data flow](../architecture/data-flow.md), and [secret provisioning](../security/key-rotation.md).
