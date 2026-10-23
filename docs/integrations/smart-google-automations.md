---
status: implemented-unreleased
owner: integrations
last_verified: 2026-10-23
sources:
  - https://developers.google.com/identity/protocols/oauth2/web-server
  - https://developers.google.com/workspace/sheets/api/scopes
  - https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list
  - https://developers.google.com/workspace/calendar/api/v3/reference/events/insert
  - https://developers.google.com/workspace/gmail/api/auth/scopes
  - https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
---

# Smart Automations: Google core

## Implemented boundary

Settings → Google Workspace opens the shared React Native screen. Sources → Gmail and Automations
link to it. Users connect Gmail, Sheets, Calendar, and Tasks independently, choose a destination,
configure source and sender policy, set confidence and approval mode, preview proposed fields,
pause execution, and review receipts. Rules extend an existing filter, rather than duplicate its
classification language. Existing Inbox approvals and Activity continue to use the same action
ledger. New output rules start disabled and require approval by default; global execution starts
paused. No sending, deletion, invitations, or arbitrary provider operations are implemented.

Capture → existing normalization/facts/events/server classification → pure policy → stable effect
identity → existing action proposal/approval → durable outbox → Workflow → provider → existing
action receipt. Only certain facts are consumed. Financial actions require a strong transaction
reference, exact positive decimal amount, and currency. Meetings require an explicit valid time
interval. Ambiguous or incomplete extraction does not trigger an effect. Confidence never replaces
authorization. Existing deterministic extraction is reused; this change adds no general AI agent.

## OAuth and credentials

`POST /api/smart-automations/connect` returns an opaque launch URL. The server stores a short-lived,
encrypted PKCE verifier and binds launch/callback through a single-use session, HttpOnly state
cookie, PKCE S256, OIDC nonce, verified Google issuer/audience/signature, and selected scopes.
Refresh tokens are encrypted in existing `connections`; access tokens exist only during backend
calls. Missing refresh tokens fail safely and require a fresh consent flow. Tokens never appear in
mobile responses. Expired OAuth sessions are removed by the enabled outbox sweep.

| Service  | Requested permission beyond `openid`                      | Behavior                                                                   |
| -------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Gmail    | `gmail.readonly`                                          | Existing encrypted Gmail ingestion/watch/history machinery                 |
| Sheets   | `drive.file`                                              | Create a Relay expense spreadsheet or choose an already app-accessible one |
| Calendar | `calendar.events.owned`, `calendar.calendarlist.readonly` | Select an owned calendar; create events without guests                     |
| Tasks    | `tasks`                                                   | Select a task list; create tasks with a stable Relay marker                |

Scope names above use the `https://www.googleapis.com/auth/` prefix. Sheets `drive.file` is
non-sensitive and does not enumerate every file in Drive. A Picker flow for granting access to
arbitrary existing files is deferred. Existing selected sheets must contain the `Relay Expenses`
tab and exact seven-column header; unrelated content is never overwritten during selection.
Gmail read access is restricted: public server-side processing requires Google verification and,
unless an exception applies, a security assessment. Recheck final scope classifications, publishing
status, verified domains, privacy disclosures, and Workspace admin restrictions before rollout.

Separate encrypted connection rows do not imply independent upstream grants. Non-Gmail Smart
disconnect disables rules, cancels unstarted actions, and deletes its local token. It does not revoke
Google authorization. Gmail disconnect deliberately reuses the existing durable stop/revoke
protocol and marks other services as needing consent. Upstream project/account revocation can
invalidate multiple tokens. A consolidated revoke-all experience is deferred. Legacy Tasks rows
without a Google subject must be explicitly disconnected before the new identity-bound flow can
replace them; a different account is never silently substituted.

## Reliability and limits

- Cross-source financial deduplication uses tenant, configured rule, destination, strong reference,
  exact amount, and currency. It intentionally avoids amount/day-only guesses. Distinct user rules
  represent distinct authorized workflows. Cross-account direction, refunds, currency conversion,
  and fuzzy receipt reconciliation are deferred.
- Sheets reserves a stable row before execution, reads it before writing, and uses `RAW` values.
  Existing exact values reconcile success; conflicting values stop execution. Users should not move
  or repurpose reserved rows. Lost spreadsheet-creation responses lock further creation until the
  file is manually selected/reconciled, avoiding duplicate files.
- Calendar uses a deterministic base32hex-compatible event ID and a private Relay marker. Tasks
  reconciles marker-bearing notes across bounded pagination; an incomplete scan fails closed.
  These are provider-specific strategies, not a universal exactly-once guarantee.
- A leased durable outbox and exponential Workflow retries bound execution to five attempts.
  Known throttling and failures before dispatch can retry. Ambiguous outcomes after a provider
  call are retained for review and are not exposed as safe manual retries. A conservative daily
  tenant limit is checked in SQL; this is not yet a distributed provider quota optimizer.
- Pause/disable/revision/connection/filter checks run again before dispatch. An external request
  already in flight cannot be recalled. Editing a rule invalidates outstanding approvals.
- Tenant composite foreign keys, RLS, backend-only execution/session tables, existing credential
  encryption/rotation, raw-data retention, and account cascades are retained. Action previews and
  receipts contain selected derived fields, so normal account deletion/retention policies still
  apply. Integration disconnect does not erase audit history or external Google records.

## Local review and deployment prerequisites

The development branch is `feat/smart-google-automations`, based on updated `origin/dev`.
No deployment, push, PR, production migration, or live Google write has been authorized.

From `apps/mobile`, with the repository's existing frozen-lockfile dependencies:

```powershell
$env:EXPO_PUBLIC_RELAY_DEMO='enabled'
$env:EXPO_NO_DOTENV='1'
$env:EXPO_OFFLINE='1'
$env:EXPO_NO_TELEMETRY='1'
node node_modules/expo/bin/cli start --web --localhost --port 8082
```

Open `http://localhost:8082`, skip synthetic onboarding if shown, then Settings → Google Workspace.
The demo has seven explicit synthetic scenarios: transaction, meeting, Gmail task, approval,
permission failure, duplicate transaction, and disconnection. No Google credentials are needed.
An isolated Chrome with CDP port 9225 can run `node scripts/smart-google-browser-e2e.mjs` from the
repository root. That script clears storage for this localhost origin in the isolated profile and
saves mobile/desktop screenshots under ignored `out/smart-google`.

For isolated backend testing, apply the two appended migrations in order, regenerate Supabase
types using the existing generator, register the four service-specific callback URIs, configure the
existing Gmail/PubSub credentials and encryption environment, bind `SMART_ACTION_WORKFLOW`, and
enable `RELAY_SMART_GOOGLE_ENABLED` in API and Pipeline. This has not been done against a live
environment. Apply no production changes as part of local review. Removing the flag disables new
execution without deleting history; forward-only migrations leave existing records compatible.

## Verification record

Canonical command output is saved locally under ignored `out/smart-google`. The full original suite
was run before implementation: it exposed an existing Windows file-URL bug in the dismissal
boundary test. That test now uses `fileURLToPath`, retaining every original boundary assertion.
Incremental mocked OAuth, provider, policy, capture-to-proposal, and synthetic demo tests were run.
Chrome verified mobile and desktop synthetic flows. Expo web export, Next.js production build with
synthetic public settings and dotenv processing disabled, and Wrangler local dry-run compilation
succeeded. Final aggregate results are reported with the delivery rather than inferred from builds.

Final regression totals: **2,017 tests passed**, with no failed or skipped tests in that run:
Contracts 90, domain 272, crypto 14, observability 7, API 176, Pipeline 373, mobile 1,050, landing
site 25, and root scripts 10. Forty-eight added tests cover policy, mocked adapters/resources,
capture-to-proposal, Workflow execution/failures, OAuth, API authorization, and synthetic demo
transitions. An unchanged OpenAI credential test timed out during an earlier concurrent build run;
the full-suite rerun passed without altering that test. Type checking, ESLint, formatting, mobile
variant/permission configuration, and each application's local production compilation passed.
Chrome also verified rule configuration, service disabling, global pause, all seven scenarios, and
an Activity receipt at mobile and desktop viewport sizes. This does not replace backend E2E.

Database migration execution, the 15 new pgTAP checks, generated Supabase type verification, and
real Queue/Workflow/Supabase E2E are blocked by the unavailable local Docker engine. Android-native
capture, native OAuth browser return, and APK/device execution are unverified without a connected
device/AVD. Browser success is not evidence of Android-native success. Google consent, refresh,
revocation, and external writes are mocked; sandbox-account acceptance remains required. Secondary
Gmail organization, Drive, Docs, Contacts, Meet, multi-service recovery, notification preferences,
and analytics are outside this core increment.
