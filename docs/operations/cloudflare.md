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
| Tenant coordinator   | `TENANT_COORDINATOR` SQLite Durable Object |
| Metrics dataset      | `relay_pipeline_production`                |
| Retention cron       | Hourly at minute 17                        |
| API to pipeline call | `PIPELINE` service binding                 |
| Public API endpoint  | `relay.redsteadz.dpdns.org` custom domain  |

Pipeline disables `workers.dev`, preview URLs, and routes. Only Queue, cron, and explicit service
binding invocations can reach it. API disables `workers.dev` and uses the stable custom domain, which
is also canonical hosted Auth origin.

Pipeline consumes both canonical ingress and dead-letter Queues. Dead-letter consumption persists
ciphertext and fixed failure metadata before acknowledgement; it does not decrypt source content.

No Action Workflow is provisioned while `/internal/actions` returns `501` and no persisted dispatch
path exists. Issue #35 owns Workflow implementation and must add the binding only with retry-safe,
persisted action execution.

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
3. Run `wrangler workflows list` and verify Relay has no Workflow before issue #35 is implemented.
4. Confirm pipeline deployment output shows Queue, Analytics Engine, SQLite Durable Object, and hourly
   cron bindings.
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

## First Recovery Rollout

Queue envelope v1 adds authenticated acceptance/expiry fields and is intentionally not compatible
with older retained Queue bodies. Before first issue #17 Pipeline deployment:

1. Pause public ingress at API edge without deleting Worker, Queue, or route.
2. Verify both canonical ingress and dead-letter Queue backlogs are exactly zero. If either is nonzero,
   resume old consumer processing or stop rollout; never acknowledge, discard, or reinterpret an old
   body to satisfy deployment timing.
3. Apply migration `202608260003_dead_letter_recovery.sql`. It adds
   `persist_encrypted_source_item_v2`; old RPC remains executable for running Worker during rollout.
4. Provision recovery secret, deploy reviewed Pipeline, then deploy reviewed API.
5. Verify both Queue consumers, DLQ producer binding, recovery auth rejection, synthetic ingress, and
   metadata-only recovery canary before resuming public ingress.

This drain gate is mandatory because old Queue ciphertext did not authenticate original acceptance or
expiry. Synthesizing those fields would extend retention and is prohibited.

## Dead-Letter Recovery

Provision one independently generated `RELAY_RECOVERY_SHARED_SECRET` into API and Pipeline. It must
differ from ingestion secret. Public API accepts it only as bearer authorization on
`/api/recovery/dead-letters`; Pipeline accepts it only on private `/internal/recovery/*` routes through
service binding. Authenticated users, mobile clients, and ingestion credential cannot inspect or
replay dead letters. Supabase recovery RPCs remain backend-secret-only.

Inventory response exposes recovery ID, envelope ID, fixed failure code, status, original acceptance
and expiry, key version, replay count, and transition timestamps. It never exposes tenant ID,
ciphertext, nonces, wrapped keys, source attributes, or plaintext. There is no recovery decrypt route.

Use password-manager injection that avoids shell history and process arguments. Inspect metadata:

```bash
printf 'header = "Authorization: Bearer %s"\n' "$RELAY_RECOVERY_TOKEN" \
  | curl --fail-with-body --silent --show-error --config - \
      'https://relay.redsteadz.dpdns.org/api/recovery/dead-letters?limit=100'
```

Select only an `available`, unexpired item after resolving its fixed failure code. Generate one UUID
request ID and retain it for retries of that operator command. Do not generate a new request ID after
an ambiguous response:

```bash
RECOVERY_ID='<dead-letter-uuid>'
REQUEST_ID='<stable-random-uuid>'
printf 'header = "Authorization: Bearer %s"\n' "$RELAY_RECOVERY_TOKEN" \
  | curl --fail-with-body --silent --show-error --config - \
      --header 'content-type: application/json' \
      --data "{\"id\":\"$RECOVERY_ID\",\"requestId\":\"$REQUEST_ID\"}" \
      'https://relay.redsteadz.dpdns.org/api/recovery/dead-letters'
```

`202` means exact ciphertext was queued. `409` means item is unavailable, active under another request,
expired, or terminal; inspect metadata again instead of changing database state. `503` after an
ambiguous request is safe to retry with same request ID. Confirm terminal `succeeded` or `duplicate`,
null key version, and matching metadata-only `dead_letter.replay_requested` plus
`dead_letter.replay_completed` audit events. Never update recovery rows manually. Expiry or successful
completion destroys ciphertext and cannot be reversed.

When Supabase recovery persistence is unavailable, DLQ consumer republishes exact encrypted message
to same canonical dead-letter Queue with five-minute delay and acknowledges only after publication.
This parking loop continues only until authenticated raw expiry; it never extends payload retention or
creates another Queue. Alert on repeated recovery persistence failures and restore Supabase before
expiry. Failed parking publication retries every ten minutes for up to 100 attempts and emits fixed
`dead_letter_parking_failed` metric; Queue's 24-hour retention remains hard outer bound during a
simultaneous Queue producer outage. Once raw expiry arrives, ciphertext is acknowledged and discarded
by design.

## Unused Action Workflow Removal

Remove the placeholder Workflow only in this order:

1. Confirm the exact hosted Workflow has no instances:

   ```bash
   pnpm --filter @relay/pipeline exec wrangler workflows instances list relay-action-workflow-production
   ```

2. Merge the binding removal through `dev` to `main`, then deploy Pipeline from clean reviewed `main`.
3. Verify authenticated ingestion, Queue persistence, DLQ configuration, hourly cron, Durable Object,
   Analytics Engine binding, and API health before deleting the resource.
4. Re-run the exact-name instance check. Stop if any instance exists.
5. Delete only the unused Relay Workflow:

   ```bash
   pnpm --filter @relay/pipeline exec wrangler workflows delete relay-action-workflow-production
   ```

6. Run `wrangler workflows list` and verify Relay has no Workflow. Re-list Pipeline bindings and rerun
   authenticated ingestion.

Workflow deletion also deletes its instances and cannot be reversed. Never use a broad or unrelated
resource name. Issue #35 must provision a new Workflow only after persisted action dispatch exists.

## Persistence Metrics

Pipeline binds Analytics Engine dataset `relay_pipeline_production` as `PIPELINE_METRICS`. Point
schema is fixed:

- `index1`: `source_item_persisted`, `source_item_duplicate`, `source_item_failed`,
  `dead_letter_parking_failed`, or `retention_purge`.
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
   or Cloudflare dashboard. Never delete canonical API, Pipeline, Queue, DLQ, or Durable Object
   resources.
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

Roll back the API caller before the pipeline target when both changed. Worker versions capture their
bindings, but rollback does not recreate deleted resource state or Durable Object storage. After
deleting `relay-action-workflow-production`, every Pipeline version that references `ACTION_WORKFLOW`
is ineligible; forward-deploy known-good code without that binding instead. A target version from
before the latest `exports` lifecycle change is likewise ineligible. Never delete Queues or Durable
Object resources during incident rollback. Retain the highest activated KEK version even when code
rolls back.

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
