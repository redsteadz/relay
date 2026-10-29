---
status: accepted
owner: maintainers
last_verified: 2026-10-23
---

# Capture/session recovery verification

Branch: `feat/smart-google-automations`. This increment is local only: no push, hosted database
change, deployment, real Google call, credential provisioning, or replacement APK.
Policy and implementation decisions are canonical in [ADR-0024](../decisions/0024-capture-safe-logout-and-recovery.md).

## Reproduced root causes

1. `AuthProvider.signOut` called native queue/key deletion and derived-store deletion without checking
   pending captures. Native tenant clearing also removes retained message bodies. Server tables were
   not deleted: auth sign-out uses local scope. Synchronized derived records can be fetched again;
   unsent captures and local-only bodies could not.
2. Inbox used `server ?? local ?? []`. A successful empty/incomplete server array hid unsynchronized
   local events. Different event IDs require reconciliation by stable source identity, with hidden
   server identities included to prevent resurrection.
3. Headless delivery skipped React's native tenant/generation preparation. SMS jobs and the
   notification reconnection sweep queued captures without requesting delivery. KEEP could drop
   arrivals after an active worker took its snapshot. The installed Expo worker lacks the foreground
   information needed for pre-Android-12 expedited work and does not translate JS failure into native
   WorkManager retry. A snapshot is capped at fifty envelopes.
4. HTTP 429 was terminal on its first mobile upload attempt; retries had no durable eligibility
   timestamp. Background consent was checked only through registration, not inside each run, and
   expired sessions were not explicitly refreshed. Independent auth clients could race token refresh.
5. Backend classification errors were logged and acknowledged. A subsequent duplicate skipped
   classification. Transient semantic failures also looked like unmatched captures. Unrelated
   maintenance errors prevented the later action-outbox sweep.

## Changed areas

- Mobile auth/settings: guarded logout with Sync Now, Cancel and explicit Discard & Sign Out; final
  count/clear under the native lock includes failed and pending unexpired rows. Shared delivery/logout
  sequencing, current-session restoration guards, shared auth client, cache cancellation/clearing,
  navigation remount, model credential cleanup and reset of device background consent.
- Inbox: server snapshot includes observed source identities; local unexpired unsynchronized IDs
  supplement empty/partial server reads without duplicate events or hidden synchronized records.
  Derivation invalidates local readers before network registration; delivery invalidates server reads.
- Device delivery: shared cold-start preparation cannot clean another account; SMS and notification
  sweeps request the installed Expo worker; APPEND_OR_REPLACE preserves follow-up work. Schema v5
  adds `next_attempt_at` with a non-destructive upgrade, exponential 30-second to 15-minute eligibility,
  bounded attempts, and delayed network-constrained recovery. Sync Now explicitly reopens unexpired
  failed captures for another attempt; automatic runs do not reset their attempt budget. Upload/registration requests have
  30-second timeouts. Batches drain within the existing 500-row queue bound.
- Pipeline: classification failures retain the durable source and retry/replay before completed dedup
  markers. Transient semantic decisions remain pending; nonretryable errors park immediately. Existing
  source/action identities and Google idempotency gates remain authoritative. Maintenance attempts the
  action outbox independently of retention, rotation and Gmail work.
- Demo/tests: synthetic queue parity, SQLite upgrade/backoff tests, headless and cache integration
  tests, semantic recovery tests, native bridge guard tests, and browser logout acceptance flows.

## Verification boundaries

Baseline: 2,017 passing tests before edits (including ten root script tests). Final verified total:
2,051 passed: mobile 1,076; Pipeline 379; API 176; contracts 90; domain 272; crypto 14; observability 7;
landing 25; root scripts 12. A complete forced workspace run passed, followed by a complete mobile
rerun after the final explicit-retry change. No failures or skips in those executed suites. Logs and
targeted post-change reruns are recorded in ignored `out/smart-google/session-background-*.log` files.
These are local evidence, not production or native-device certification.

| Check                                                      | Status / meaning                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace regression/unit/mocked integration suites        | 2,051 passed; baseline 2,017                                                                                                                  |
| SQLite/cache logout integration                            | Passed using real Node SQLite and TanStack Query; native/auth transport mocked                                                                |
| Native queue migration/backoff SQL                         | Passed against actual shipped SQL in Node SQLite; Kotlin/Keystore execution unverified                                                        |
| Chrome synthetic E2E                                       | Passed all seven automations, pause/disable, history after login, pending/failed warning, Cancel, nondiscarding Sync Now and explicit discard |
| TypeScript / ESLint / formatting                           | Passed; no tests disabled to pass                                                                                                             |
| Mobile web production export / Worker dry-run bundle       | Passed locally; no upload/deployment                                                                                                          |
| Supabase migration/RLS and full local backend E2E          | Blocked: Docker engine probe times out; not run for this increment                                                                            |
| Android Kotlin compilation / device E2E                    | Not run: no generated native project, connected device or AVD; no new native build authorized                                                 |
| Gmail Pub/Sub / OAuth / Google writes in a sandbox account | Mocked tests only; real infrastructure not accessed                                                                                           |

Browser preview: [localhost:8082](http://localhost:8082). Use Settings → Google Workspace for the
seven scenarios; Settings → Account for logout. The synthetic demo normally has no unsent queue.
The browser test seeds a synthetic failed row in an isolated Chrome profile to exercise that warning.
It confirms Sync Now does not silently discard that row, not a successful native upload.
The demo has one fixed account, so browser login testing does not establish real multi-account RLS.

To reproduce browser acceptance, start isolated Chrome with debugging port 9225, then run
`node scripts/smart-google-browser-e2e.mjs http://localhost:8082`. It clears only that browser profile's
localhost demo origin, uses synthetic fixtures, and saves screenshots under ignored `out/smart-google`.

## Android acceptance after approval of a native test build

Use an isolated development backend, two synthetic test accounts and sandbox Google destinations.
A standalone demo APK cannot prove real capture, authenticated upload, Pub/Sub or Google execution.
New native method signatures and the SQLite upgrade require a fresh custom Android build; an
existing APK or Metro/browser refresh is insufficient. No build is prepared by this increment.

1. Upgrade a test installation with an unexpired queued capture. Verify SQLite upgrade retains it.
   Sign in as A, grant disclosed SMS/notification access, choose allowlists, and opt into background
   delivery. Keep destructive notification behavior disabled unless separately authorized.
2. Capture synthetic SMS/notifications offline. Confirm pending Inbox rows remain with empty server
   results. Sign out: Cancel must retain session/queue; failed Sync Now must retain both; reconnect
   and Sync Now must obtain durable acknowledgement before clearing. Repeat with explicit discard
   and confirm only A's local queue/body/store/settings are removed.
3. Sign in again as A. Confirm previously synchronized Inbox facts, classifications and Activity
   return from the backend. Local message bodies cleared at logout are expected to be unavailable.
   Sign out, sign in as B, and verify A's data/search/detail/undo/settings are absent. Repeat A→B→A.
4. Background Relay and receive eligible SMS/notifications, including a burst over fifty captures.
   Confirm encrypted enqueue precedes delivery, immediate follow-up work is scheduled, and each
   acknowledged capture yields at most one authorized Google effect. Disable capture/background
   consent and verify the corresponding delivery/source behavior stops.
5. Test system process death (not user force-stop), restart with queued work, network loss/restoration,
   expired access token, HTTP 429/503 and retry eligibility. Verify task definition loading and
   WorkManager execution on pre-12 and 12+ Android, including battery saver/OEM restrictions.
6. Inject classification/semantic outages in the test backend, recover them, and inspect stable source
   IDs/action receipts. Exhaust retries, correct configuration, and use the existing authorized
   encrypted dead-letter replay before raw expiry. Do not replay real personal captures.
7. With mobile signed out/closed, send Gmail to the sandbox mailbox. Verify push/history processing
   continues server-side. Independently test Gmail disconnection, rule disable and global pause.

Android provides no guaranteed execution latency and force-stop can prevent background work until
the user reopens the app. Existing capture/retention limits and encrypted raw expiry still apply;
exhausted device attempts require explicit Sync Now; backend retry exhaustion requires existing
recovery tooling. Exactly-once model requests are not claimed
after an ambiguous classification write, but source/action/provider idempotency remains required.
References: [Android persistent work](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work),
[Expo background tasks](https://docs.expo.dev/versions/latest/sdk/background-task/),
[Gmail push](https://developers.google.com/workspace/gmail/api/guides/push).
