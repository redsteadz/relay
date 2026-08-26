---
status: accepted
owner: maintainers
last_verified: 2026-08-26
---

# Cloudflare Hosted Runtime Operations

## Resource Contract

Relay uses one Cloudflare account and one hosted runtime under
[ADR-0007](../decisions/0007-shared-hosted-runtime.md). Production-suffixed names remain because those
resources already own durable state; the suffix is historical and does not imply a second deployment.

| Resource             | Canonical hosted value                     |
| -------------------- | ------------------------------------------ |
| API Worker           | `relay-api-production`                     |
| Pipeline Worker      | `relay-pipeline-production`                |
| Ingress Queue        | `relay-ingress-production`                 |
| Dead-letter Queue    | `relay-ingress-dead-letter-production`     |
| Action Workflow      | `relay-action-workflow-production`         |
| Tenant coordinator   | `TENANT_COORDINATOR` SQLite Durable Object |
| Retention cron       | Hourly at minute 17                        |
| API to pipeline call | `PIPELINE` service binding                 |
| Public API endpoint  | `relay.redsteadz.dpdns.org` custom domain  |

Pipeline disables `workers.dev`, preview URLs, and routes. Only Queue, cron, and explicit service
binding invocations can reach it. API disables `workers.dev` and uses the stable custom domain, which
is also canonical hosted Auth origin.

Ingress and dead-letter Queue messages use 24-hour retention at provisioning time. Cloudflare fixes
Free-plan retention at 24 hours. A failed ingress message can spend one retention period in ingress
and another after transfer to the dead-letter Queue, so old-KEK retirement requires a 48-hour wait
plus empty-backlog verification when operators do not drain both Queues.

## Ownership

Maintainers own shared runtime. Hosted changes require reviewed `dev` to `main` release and named
operator. Never deploy feature branches or `dev` remotely. Store Cloudflare account IDs and tokens in
operator or CI secret stores, not repository. Resource names never contain tenant IDs, provider
accounts, credentials, or source content.

## First Provisioning

Confirm target Cloudflare account and plan before creating resources. Create Queues first:

```bash
pnpm --filter @relay/pipeline exec wrangler queues create relay-ingress-production --message-retention-period-secs 86400
pnpm --filter @relay/pipeline exec wrangler queues create relay-ingress-dead-letter-production --message-retention-period-secs 86400
```

Provision one secret set from [key runbook](../security/key-rotation.md) and Supabase values from issue
#9. Wrangler declares required secret names without values. Export API and Pipeline JSON secret files
into random owner-only directory. Keep them outside repository, delete immediately after deployment,
and never print contents:

```bash
umask 077
SECRET_DIR="$(mktemp -d)"
trap 'rm -rf -- "$SECRET_DIR"' EXIT
test "$(stat -c %a "$SECRET_DIR")" = "700"
<password-manager-export-pipeline> > "$SECRET_DIR/pipeline.json"
<password-manager-export-api> > "$SECRET_DIR/api.json"
```

API build requires nonempty hosted `NEXT_PUBLIC_SUPABASE_URL` and publishable key in the historically
named `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Next.js freezes values during build, so load and validate them
only after checking out reviewed `main`:

```bash
git switch main
git fetch origin main
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
export NEXT_PUBLIC_SUPABASE_URL="$(<password-manager-read-hosted-supabase-url>)"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(<password-manager-read-hosted-supabase-publishable-key>)"
test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY"
pnpm --filter @relay/pipeline deploy:hosted -- --secrets-file "$SECRET_DIR/pipeline.json"
pnpm --filter @relay/api deploy:hosted -- --secrets-file "$SECRET_DIR/api.json"
unset NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
rm -rf -- "$SECRET_DIR"
trap - EXIT
```

Issue #7 records historical provisioning; issue #63 records consolidation. `deploy:hosted` is sole
hosted command. Environment-specific deploy scripts are intentionally absent.

## Verification

1. Run `wrangler queues list` and verify canonical ingress and dead-letter names. Inspect each Queue's
   `message_retention_period` through Cloudflare API or dashboard and update when it differs:

   ```bash
   pnpm --filter @relay/pipeline exec wrangler queues update <queue-name> --message-retention-period-secs 86400
   ```

2. Run `wrangler deployments list` in both app directories.
3. Run `wrangler workflows list` and verify canonical action Workflow.
4. Confirm pipeline deployment output shows Queue, Workflow, SQLite Durable Object, and hourly cron
   bindings.
5. Confirm Pipeline has no public URL, route, or preview URL. Confirm API binds `PIPELINE` to
   `relay-pipeline-production`.
6. Trigger synthetic authenticated ingress only after Supabase and issue #6 secrets are provisioned.
   Verify Queue acknowledgement follows durable persistence and logs contain metadata only.
7. Test the scheduled handler locally after loading synthetic development configuration. Run
   Wrangler in one terminal:

   ```bash
   pnpm --filter @relay/pipeline exec wrangler dev --local --test-scheduled
   ```

   Call the scheduled route from a second terminal:

   ```bash
   curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=17+*+*+*+*"
   ```

   After remote deployment, verify cron `17 * * * *` and a successful invocation in Cron Events.
   Confirm cleanup logs contain no row contents.

Record nonsecret resource names, deployment version IDs, timestamps, and operator in release issue.

## Persistence Metrics

Pipeline binds Analytics Engine dataset `relay_pipeline_production` as `PIPELINE_METRICS`. Point
schema is fixed:

- `index1`: `source_item_persisted`, `source_item_duplicate`, `source_item_failed`, or
  `retention_purge`.
- `double1`: count.
- `double2`: latency in milliseconds.
- blobs and remaining indexes/doubles: unused.

Do not add tenant, envelope, source, URL, ciphertext, error, or plaintext dimensions. Metric write
failure never changes Queue retry, persistence, or cleanup behavior.

For hosted persistence verification, use an operator-controlled synthetic account and random device,
envelope, and provider IDs. Register the device through the public API, submit only the deterministic
synthetic fixture, and inspect only row count, encryption-component presence, key version, scope, and
expiry. Repeat source identity and fingerprint deliveries, verify row count remains one, expire only
the synthetic row, invoke cleanup with current time rather than a future override, verify every raw
encryption component is null while metadata remains, then delete the synthetic row and device. Record
only deployment version, timestamp, counts, latency, and pass/fail result.

## Consolidation Cutover

Legacy development resources predate ADR-0007. Configuration removal does not stop their Queue
consumers, cron, public endpoint, or existing deployments. Decommission them only after all gates pass:

1. Confirm `public.kek_encryption_inventory('development')` returns no rows and metadata-only counts
   find no encrypted hosted row with `encryption_environment='development'`.
2. Confirm `relay-ingress-development` and `relay-ingress-dead-letter-development` have zero backlog.
   Pause producer access and wait one full 48-hour ingress-plus-DLQ retention window when backlog
   history is uncertain.
3. Confirm no `relay-action-workflow-development` instance is running or waiting.
4. Deploy canonical Pipeline and API from clean reviewed `main`; run authenticated synthetic canary
   through custom domain and verify encrypted persistence plus cleanup.
5. Disable or delete `relay-api-development` first so no caller can publish new work. Then delete
   `relay-pipeline-development`, development Workflow, and empty development Queues through Wrangler
   or Cloudflare dashboard. Never delete canonical production-suffixed resources.
6. Re-list Workers, Queues, Workflows, cron triggers, and service bindings. Record nonsecret deletion
   timestamps. Retain development KEK recovery copy until database, Queue, Durable Object, Workflow,
   and backup inventories are all zero.

Cloudflare deletion is irreversible for Worker-local state. If any gate is nonzero, stop cutover and
inventory state; do not relabel, replay, or discard encrypted work to satisfy topology decision.

## Local End-To-End Verification

Run the complete synthetic ingress path with one command from the repository root:

```bash
npx pnpm@11.23.0 e2e:local
```

Docker must be running. The harness starts local Supabase when needed, resets and seeds it, builds
shared packages, and launches API plus Wrangler with `--config wrangler.e2e.jsonc --local`. Explicit
`RELAY_PIPELINE_URL` routing takes precedence over Cloudflare service bindings only outside
production. The harness uses temporary random secrets, rejects non-loopback Supabase status, removes
temporary Worker state, and stops Supabase only when it started the stack. No Cloudflare login,
remote Queue, remote Worker, or hosted Supabase project participates.

## Rollback

List deployments, select known-good version, and record reason:

```bash
pnpm --filter @relay/api exec wrangler deployments list
pnpm --filter @relay/api exec wrangler rollback <version-id> --message "rollback reason"
pnpm --filter @relay/pipeline exec wrangler deployments list
pnpm --filter @relay/pipeline exec wrangler rollback <version-id> --message "rollback reason"
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

Related: [shared hosted runtime](../decisions/0007-shared-hosted-runtime.md),
[Cloudflare processing boundary](../decisions/0002-cloudflare-processing-boundary.md),
[data flow](../architecture/data-flow.md), and [secret provisioning](../security/key-rotation.md).
