---
status: implemented-unreleased
owner: integrations
last_verified: 2026-10-24
sources:
  - https://developers.google.com/identity/protocols/oauth2/web-server
  - https://developers.google.com/identity/protocols/oauth2
  - https://developers.google.com/workspace/sheets/api/scopes
  - https://developers.google.com/workspace/gmail/api/guides/push
---

# Senior review: Android and Google setup

This checklist describes `feat/smart-google-automations`, including `aaeb966`. It contains no credentials.
Canonical behavior/scopes: [Smart Google core](../integrations/smart-google-automations.md).
Native recovery acceptance: [session/background verification](session-background-verification.md).

## Choose the mode first

| Mode                | APK inputs                                                            | Backend/Google requirement                                                                                         |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Synthetic UI        | `EXPO_PUBLIC_RELAY_DEMO=enabled`; sideload profile for standalone APK | None: synthetic auth, ingress, destinations and receipts; not evidence of native capture or Google execution       |
| Real Android client | Public API/Supabase settings; demo unset; sideload profile            | Reachable isolated API, Pipeline, Supabase and pre-created test account; capture consent                           |
| Real Google actions | Same APK as real client                                               | All backend configuration below, reviewed migrations, OAuth consent, enabled services/rules and unpaused execution |

An APK can compile without working Google services. Public Expo values are bundled at build time; changing
server settings cannot correct a wrong URL/key in an installed APK. `localhost` and emulator address
`10.0.2.2` do not provide a phone-independent backend.

## Configuration inventory

Configure mobile public values in the selected EAS environment (`preview` for sideload), or the local
build process. API `NEXT_PUBLIC_*` values must be available at Next/OpenNext build time and matching
API runtime configuration. API server settings/secrets belong to its Cloudflare Worker; Pipeline
settings/secrets belong to its separate Worker. A root `.env` alone does not provision Worker secrets,
EAS variables, bindings, or a hosted Supabase Auth configuration.

| Exact name                                                                                                               | Location                             | Requirement/purpose                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `EXPO_PUBLIC_API_URL`                                                                                                    | Mobile/EAS                           | Real client: reachable HTTPS API origin                                                                                              |
| `EXPO_PUBLIC_SUPABASE_URL`                                                                                               | Mobile/EAS                           | Real client: matching isolated Supabase project                                                                                      |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`                                                                                          | Mobile/EAS                           | Real client: public publishable/anon key, never backend secret                                                                       |
| `RELAY_BUILD_VARIANT`                                                                                                    | Mobile/EAS build                     | `sideload` includes READ_SMS/RECEIVE_SMS; `development` blocks them; profiles supply this                                            |
| `EXPO_PUBLIC_RELAY_DEMO`                                                                                                 | Mobile/EAS build                     | Exactly `enabled` selects synthetic environment; unset for real capture/actions                                                      |
| `EXPO_PUBLIC_RELAY_LOCAL_DIAGNOSTICS`                                                                                    | Mobile/EAS                           | Optional; `disabled` blocks local diagnostics; diagnostic profile supplies it                                                        |
| `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, `EXPO_PUBLIC_REVENUECAT_IOS_KEY`                                                   | Mobile/EAS                           | Optional store/paywall public keys, unrelated to Google; omit for this test                                                          |
| `EXPO_PUBLIC_DEBUG`                                                                                                      | Mobile/EAS                           | Optional structured diagnostics, normally unset                                                                                      |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                                              | API build/runtime                    | Required real auth and user-scoped database access; same project as mobile                                                           |
| `SUPABASE_URL`                                                                                                           | API + Pipeline                       | Durable backend project URL; API can fall back to NEXT_PUBLIC URL, Pipeline cannot                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                                              | API + Pipeline secrets               | Backend-only **`sb_secret_...`** key: Pipeline explicitly rejects legacy JWT keys despite historical variable name                   |
| `RELAY_CREDENTIAL_KEK_KEYRING`                                                                                           | API + Pipeline secrets               | Same versioned keyring; each key is base64-encoded 32 bytes; encrypts credentials/raw ingress; preserve old versions during rotation |
| `RELAY_ENVIRONMENT`                                                                                                      | API + Pipeline                       | Matching encryption namespace, `development` or `production`; not `staging`. Independent of NODE_ENV                                 |
| `RELAY_INGEST_SHARED_SECRET`                                                                                             | API + Pipeline secrets               | Matching private ingress authorization secret                                                                                        |
| `RELAY_RECOVERY_SHARED_SECRET`                                                                                           | API + Pipeline secrets               | Matching privileged recovery authorization secret                                                                                    |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                                                               | API + Pipeline secrets               | Same Google Web OAuth client for consent/code exchange and refresh; never mobile                                                     |
| `RELAY_GOOGLE_REDIRECT_ORIGIN`                                                                                           | API                                  | Required hosted Smart OAuth origin, HTTPS with no path/query; localhost fallback is unsuitable for production                        |
| `RELAY_SMART_GOOGLE_ENABLED`                                                                                             | API + Pipeline                       | Exactly `true` enables Smart endpoints/planning/execution; absent/other value is disabled                                            |
| `GOOGLE_GMAIL_PUBSUB_TOPIC`                                                                                              | Pipeline secret/config               | Gmail input: full `projects/PROJECT/topics/TOPIC`                                                                                    |
| `GOOGLE_PUBSUB_MESSAGE_RETENTION_SECONDS`                                                                                | Pipeline                             | Gmail: match actual Pub/Sub retention; checked-in value 604800                                                                       |
| `GOOGLE_PUBSUB_AUDIENCE`                                                                                                 | API secret/config                    | Gmail: exact push JWT audience, normally full HTTPS `/api/connectors/gmail/push` URL                                                 |
| `GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL`                                                                                    | API secret/config                    | Gmail: exact authenticated push service-account email                                                                                |
| `RELAY_DEAD_LETTER_QUEUE`                                                                                                | Pipeline                             | Exact configured DLQ name for consumer routing                                                                                       |
| `NODE_ENV`                                                                                                               | API build/runtime                    | Publicly reachable test API must enforce `production` auth; nonproduction enables development-user header bypass                     |
| `NEXTJS_ENV`                                                                                                             | API Worker                           | Checked-in adapter setting `production`                                                                                              |
| `DEBUG`                                                                                                                  | API + Pipeline                       | Optional structured diagnostics; normally unset                                                                                      |
| `RELAY_SEMANTIC_BASE_URL`, `RELAY_SEMANTIC_MODEL`, `RELAY_SEMANTIC_RESPONSE_FORMAT`                                      | Pipeline                             | Optional semantic endpoint defaults; not Google requirements. Use existing supported settings, not arbitrary provider URLs           |
| `RELAY_PIPELINE_URL`                                                                                                     | Local API only                       | Nonproduction HTTP fallback when no Cloudflare service binding                                                                       |
| `RELAY_ALLOW_LOCAL_STUB`                                                                                                 | Local API only                       | Test stub, never proof of durable delivery; do not enable for real tests                                                             |
| `RELAY_ALLOW_LOCAL_DURABILITY`                                                                                           | Local Pipeline only                  | Test-only non-Supabase durability; forbidden in production namespace                                                                 |
| `RELAY_E2E_MODE`, `RELAY_E2E_DEAD_LETTER_QUEUE`, `RELAY_E2E_RETENTION_NOW`                                               | Local Pipeline harness only          | Harness behavior/control; omit from hosted runtime                                                                                   |
| `RELAY_AUTH_SITE_URL`, `RELAY_AUTH_WEB_REDIRECT_URL`                                                                     | Supabase local config/operator setup | Exact auth site and web callback, not Google callbacks                                                                               |
| `RELAY_SUPABASE_ENVIRONMENT`, `RELAY_SUPABASE_PROJECT_REF`                                                               | Operator shell only                  | Existing hosted Auth helper uses `hosted` and project ref; not APK values                                                            |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`                                                                          | Operator shell only                  | CLI/management/migration access, never application/client credentials                                                                |
| `EXPO_NO_DOTENV`, `EXPO_OFFLINE`, `EXPO_NO_TELEMETRY`                                                                    | Local Expo tooling                   | Optional isolation/offline/telemetry controls; not backend execution flags                                                           |
| `RELAY_TEST_SMTP_HOST`, `RELAY_TEST_SMTP_PORT`, `RELAY_TEST_SMTP_USER`, `RELAY_TEST_SMTP_PASSWORD`, `RELAY_TEST_SMTP_TO` | Optional test-email script only      | Not runtime requirements or Supabase SMTP config; synthetic email sender harness                                                     |

There is no required global `OPENAI_API_KEY` for these Google adapters. Semantic clauses use existing
per-user encrypted model credentials and explicit disclosure opt-in; deterministic extraction does not
become general free-text AI extraction just because Google is connected. API, Pipeline and mobile
must share compatible project/namespace, not private credentials in the client.

### Placeholder-only configuration templates

Mobile/EAS real-client values:

```dotenv
EXPO_PUBLIC_API_URL=https://TEST_API_HOST
EXPO_PUBLIC_SUPABASE_URL=https://TEST_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=REPLACE_WITH_PUBLIC_PUBLISHABLE_KEY
RELAY_BUILD_VARIANT=sideload
EXPO_PUBLIC_RELAY_LOCAL_DIAGNOSTICS=disabled
# EXPO_PUBLIC_RELAY_DEMO must be unset for real tests.
```

Backend template: split by the ownership table above; upload private values only through the owning
Worker's secret store. This is documentation, not an executable environment or deployment command.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://TEST_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=REPLACE_WITH_PUBLIC_PUBLISHABLE_KEY
SUPABASE_URL=https://TEST_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=REPLACE_WITH_SB_SECRET_KEY
RELAY_ENVIRONMENT=development
RELAY_CREDENTIAL_KEK_KEYRING={"activeVersion":1,"keys":{"1":"REPLACE_WITH_BASE64_32_BYTE_KEY"}}
RELAY_INGEST_SHARED_SECRET=REPLACE_WITH_RANDOM_TEST_SECRET
RELAY_RECOVERY_SHARED_SECRET=REPLACE_WITH_DIFFERENT_RANDOM_TEST_SECRET
GOOGLE_CLIENT_ID=REPLACE_WITH_TEST_WEB_CLIENT_ID
GOOGLE_CLIENT_SECRET=REPLACE_WITH_TEST_WEB_CLIENT_SECRET
RELAY_GOOGLE_REDIRECT_ORIGIN=https://TEST_API_HOST
RELAY_SMART_GOOGLE_ENABLED=false
GOOGLE_GMAIL_PUBSUB_TOPIC=projects/TEST_PROJECT/topics/TEST_TOPIC
GOOGLE_PUBSUB_MESSAGE_RETENTION_SECONDS=604800
GOOGLE_PUBSUB_AUDIENCE=https://TEST_API_HOST/api/connectors/gmail/push
GOOGLE_PUBSUB_SERVICE_ACCOUNT_EMAIL=TEST_PUSH_ACCOUNT@TEST_PROJECT.iam.gserviceaccount.com
RELAY_DEAD_LETTER_QUEUE=TEST_DLQ_NAME
```

Enable the Smart flag only after isolated infrastructure/consent validation. `RELAY_ENVIRONMENT=development`
does not authorize a public API development-auth bypass: build/run that API with `NODE_ENV=production`.

## Google Cloud and OAuth

1. Use a dedicated test Cloud project and **Web application** OAuth client. This implementation uses
   backend web authorization, not an Android OAuth client or APK SHA fingerprint flow. Enable Gmail,
   Sheets, Drive (spreadsheet discovery), Calendar, Tasks APIs, plus Cloud Pub/Sub for Gmail capture.
2. Configure consent screen/audience/test users. Authorize offline access using the app flow; never
   paste refresh tokens into mobile. Smart OAuth uses PKCE, state cookie, OIDC identity and incremental
   consent; the backend requires a refresh token. Google Testing refresh tokens normally expire in
   seven days for these scopes. See [Google OAuth lifecycle](https://developers.google.com/identity/protocols/oauth2).
3. Register these exact Google authorized redirect URIs on the Web client, replacing the origin:

```text
https://TEST_API_HOST/api/smart-automations/oauth/gmail/callback
https://TEST_API_HOST/api/smart-automations/oauth/google-sheets/callback
https://TEST_API_HOST/api/smart-automations/oauth/google-calendar/callback
https://TEST_API_HOST/api/smart-automations/oauth/google-tasks/callback
```

Existing connector routes additionally need `/api/connectors/gmail/callback` and
`/api/connectors/google-tasks/callback` if those legacy entry points are used. Supabase login is
separate: allow `com.redsteadz.relay://auth/callback` plus the approved exact web `/auth/callback`.
The Google redirect is not the mobile custom scheme. Reopen/refresh Relay after browser consent.

4. Exact Smart scopes: `openid` plus the service scopes in the canonical [OAuth table](../integrations/smart-google-automations.md#oauth-and-credentials).
   Sheets requests `https://www.googleapis.com/auth/drive.file`, not broad spreadsheets/Drive scopes;
   Tasks requests `https://www.googleapis.com/auth/tasks`; Calendar requests
   `https://www.googleapis.com/auth/calendar.events.owned` and
   `https://www.googleapis.com/auth/calendar.calendarlist.readonly`; Gmail requests
   `https://www.googleapis.com/auth/gmail.readonly`.
   [Sheets scope policy](https://developers.google.com/workspace/sheets/api/scopes) classifies drive.file
   as non-sensitive. Gmail read is restricted; review verification/security-assessment obligations
   before public use. Review Calendar/Tasks scope verification in the Google console as well.
5. For Gmail only: create same-project Pub/Sub topic, grant publisher to
   `gmail-api-push@system.gserviceaccount.com`, configure authenticated push to the API push URL with
   the configured audience/service-account identity and required token-creation IAM. Match actual topic
   retention. See [Gmail push setup](https://developers.google.com/workspace/gmail/api/guides/push).
   Gmail watch/history and renewal are server-side, independent of mobile login; this is not a historical
   full-mailbox import. SMS-only Google output testing does not need mailbox ingestion, although default
   Wrangler secret declarations still list Gmail configuration.

## Durable services and controls

- Supabase: apply the complete ordered migration history to an **isolated** project, including
  `202610230001_google_action_providers.sql` then `202610230002_smart_google_automations.sql`.
  Preserve RLS/backend-only RPC grants. Do not edit applied migrations or reset a shared database.
  Existing connection encryption, action rules/runs, device enrollment and facts/events are prerequisites.
  Check generated types with `pnpm supabase:types:check` against local isolated Supabase.
- API Worker: assets/OpenNext output, `WORKER_SELF_REFERENCE` to itself, `PIPELINE` service binding
  to the matching private Pipeline Worker.
- Pipeline Worker: `INGRESS_QUEUE`, `DEAD_LETTER_QUEUE`, matching ingress/DLQ consumers,
  `TENANT_COORDINATOR` SQLite Durable Object (`TenantCoordinator`), and `SMART_ACTION_WORKFLOW`
  (`SmartActionWorkflow`). Missing Workflow binding prevents outbox dispatch.
- Checked-in names are `relay-api-production`, `relay-pipeline-production`,
  `relay-ingress-production`, `relay-ingress-dead-letter-production`, `relay-smart-google-actions`.
  These identify shared resources, **not a safe test deployment template**. Use separately approved
  resource names/bindings for isolated tests. Preserve cron `17 * * * *` for maintenance/recovery and
  `PIPELINE_METRICS` Analytics Engine binding (optional in code, declared by current configuration).
- Execution requires Pipeline flag=true, unpaused tenant settings, enabled rule and service, connected
  identity/scopes/destination, matching filter/source/sender/confidence and approval where required.
  API flag gates Smart endpoints/OAuth. For an operator execution kill switch disable Pipeline flag;
  disabling API flag alone does not stop already queued Pipeline work. Pause cannot recall an external
  request Google already accepted. Revisions invalidate stale approvals.

## Current shared-environment status and blockers

The repository omits `RELAY_SMART_GOOGLE_ENABLED` in both default Worker vars: **disabled by default**.
The Workflow binding is declared, which is not evidence of deployment. Deployed overrides, migrations,
OAuth client permissions and tenant configuration were not inspected; real execution in the shared
runtime is **unverified**, not claimed enabled or conclusively disabled remotely.

No isolated hosted backend/test account is supplied. The canonical shared host and historically named
`relay-development` Supabase project are live shared infrastructure. Existing EAS environment labels
and static landing previews do not provision testing services. Current ADR-0007 accepts one hosted
runtime; adding staging requires an explicitly reviewed decision/configuration, not silently reusing
production. Existing Auth setup helper rejects staging hosts, mobile callback/package are fixed, and
sign-up is disabled (`shouldCreateUser:false`). An operator must create test accounts, configure usable
email delivery and approve isolated Auth callback policy. Do not run the hosted Auth helper unchanged
against shared infrastructure for this purpose.

## Build and test sequence

1. Check out the latest feature branch; install frozen-lockfile dependencies using pinned pnpm 11.23.0
   and supported Node 22 (EAS pins 22.23.2). Run format/lint/typecheck/test and mobile build-config check.
2. For UI-only review set demo=enabled. For real capture obtain the isolated public settings and test
   account first; unset demo. No Google secret or Worker deployment is needed merely to compile an APK.
3. From `apps/mobile`, with EAS CLI 22.3.0/account access and Android signing credentials, run
   `eas build --platform android --profile sideload`. This existing internal APK profile bundles JS;
   `development` and `diagnostic` are development clients requiring Metro. EAS environment `preview`
   must contain the chosen public values (and demo=enabled only for a synthetic build). No new EAS
   project is required by the source; access to the configured project is required. Keep APK signing
   credentials in EAS/local keystore management, not Expo public variables.
4. Local alternative: build workspace mobile dependencies, run Expo Android prebuild with the selected
   environment, then `assembleRelease` using the generated Gradle wrapper (`gradlew.bat` on Windows).
   Expo CNG is authoritative. Only regenerate a clean native tree when no manual native edits need
   preservation. Match the generated Gradle/SDK/NDK requirements; configure JDK/ANDROID_HOME and signing.
   The demo helper invokes a Unix wrapper path, so Windows builders should use the explicit native
   build route. Output is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`.
5. Install on a consenting test phone. Current demo and real builds share package `com.redsteadz.relay`;
   they replace each other and signature mismatch may require uninstall (which deletes local data).
   Do not replace a personal-data installation without explicit data-loss review.
6. Synthetic mode: Settings → Google Workspace → Try a scenario; exercise all seven, Inbox approvals,
   Activity, pause/disconnect. This requires no Google account and proves no actual provider write.
7. Real mode: operator prepares the approved isolated backend above, runs database/security tests,
   configures OAuth and enables both backend flags. Sign in with the pre-created account; grant capture
   permissions/consent. Connect each sandbox Google service; select/create an expense sheet, owned
   calendar and task list. Configure an existing filter and corresponding output rule, permitted input
   sources/senders and threshold. Preview, enable and unpause; start with manual approval.
8. Use synthetic SMS/Gmail content that produces supported structured facts; inspect facts/classification
   before expecting a proposal. Free-text-only emails do not automatically supply financial/meeting
   facts. Approve and verify one external sandbox write plus receipt. Repeat source delivery to verify
   deduplication; test failures, pause/disconnect and backend recovery. Follow the native acceptance
   checklist for offline logout, A→B→A isolation, cold start and background delivery.
9. Run `pnpm e2e:local` only against isolated local resources and the database migration/RLS suite when
   Docker is available. Separate mocks/browser success from actual native and Google sandbox results.
   Latest recorded regression: 2,051 passed; native compilation/device and live Google acceptance remain
   unverified. Historical database CI passed 512 assertions before the latest recovery increment.

Building or reviewing this documentation does not authorize deployment, hosted mutation or live writes.
