---
status: accepted
owner: mobile
last_verified: 2026-08-28
sources:
  - https://docs.expo.dev/modules/overview/
  - https://developer.android.com/training/package-visibility/declaring
  - https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE
  - https://support.google.com/googleplay/android-developer/answer/10208820
---

# Android Notifications And SMS

Expo local modules provide Kotlin access unavailable in Expo Go. Relay uses a custom development or
sideload APK and Continuous Native Generation.

`NotificationListenerService` can observe posted notifications after user grants system listener
access. Capture must support app allowlists, field minimization, encrypted offline queue, server
acknowledgement, and explicit revocation. Source cancellation is irreversible from Relay's point of
view and follows the stronger gates in [action model](../architecture/action-model.md).

The native capture queue stores only AES-256-GCM ciphertext in SQLite. Its per-tenant key is
non-exportable Android Keystore material, and tenant/envelope identity is authenticated as associated
data. Capture adapters assign the envelope UUID once before enqueueing. The queue retains that UUID
across process restarts and retries, expires items seven days after capture, and enters an explicit
failed state for terminal responses or exhausted retries. It is bounded to 500 items and 2 MiB per
tenant. A device item is deleted only when `/api/ingest` returns `202` with a validated
`{ accepted: true, durable: true, id }` acknowledgement for the same envelope. Sign-out and device
revocation delete the Keystore key before deleting tenant rows, so an interrupted clear cannot leave
decryptable source data.

`READ_SMS` and `RECEIVE_SMS` are sensitive Google Play permissions. Google documents possible
exceptions for device automation and SMS-based money management, subject to review. MVP therefore
uses sideload distribution and prominent consent. Non-SMS builds remain an architectural
requirement for later Play distribution.

iOS does not expose equivalent arbitrary notification or SMS ingestion. iOS scope is Gmail and
Relay's own inbox.

## Development And Sideload Builds

Relay uses two internal Android APK profiles. Both use Node.js 22.23.2, pnpm 11.23.0, EAS CLI 22.3.0,
and the EAS `development` environment. Generated `android/` and `ios/` directories remain ignored;
Expo Continuous Native Generation recreates them from app config and the local Expo module.
EAS `corepack` remains disabled because its shim conflicts with the builder's pinned pnpm installer.
The approved EAS project is [`@harcoleis-team/relay`](https://expo.dev/accounts/harcoleis-team/projects/relay),
with project ID `abda47b3-6e3d-43db-94de-bea147723388`.

| Profile       | Purpose                         | Developer tools | SMS permissions                    |
| ------------- | ------------------------------- | --------------- | ---------------------------------- |
| `development` | Custom client for Metro and IDE | Included        | Explicitly removed during prebuild |
| `sideload`    | Internal permission-bearing APK | Excluded        | `READ_SMS` and `RECEIVE_SMS`       |

Only a JavaScript development runtime in the `development` build variant may enter the app without
authentication. On Android, this local path uses a stable synthetic tenant with separate native
notification configuration and encrypted queue. It never invokes capture sync or uploads without a
real session. An unauthenticated development-local startup preserves that queue for diagnostics. A
real session, or any startup where development-local access is unavailable (including a sideload or
release-profile transition that retains app data), deletes the synthetic key, queue, and capture
configuration before refreshing capabilities or starting authenticated sync. Authenticated controls
therefore require a fresh disclosure and configuration. Native tenant preparation also clears a
different previously configured tenant before local or authenticated capture begins, including after
unexpected session loss. Navigation and authenticated sync remain blocked until native tenant
preparation succeeds. Generation ordering prevents superseded authentication transitions from
mutating current capture keys, queues, or configuration. Native queue and configuration methods also
reject tenant IDs and preparation generations that do not match the latest prepared auth epoch.

Notification source selection queries only activities declaring the launcher intent through an
explicit package-visibility `<queries>` entry. Relay does not request `QUERY_ALL_PACKAGES`. Installed
app labels and the complete launchable-app list remain on device and are never logged or uploaded.
For authenticated captures, the selected package ID becomes `source.applicationId` provenance and is
uploaded only with a captured envelope.

Development-local diagnostics decrypt ready queue entries inside the Kotlin module, parse them
natively, discard non-notification envelopes, and bridge only sender, subject, body, application ID,
and capture time to the focused viewer. Full decrypted envelopes remain available only to the
authenticated sync path. Polls are serialized, stale results are ignored, and preview state is
cleared on screen blur, app backgrounding, and unmount. While the viewer is focused, Android
`FLAG_SECURE` blocks screenshots and recent-task previews; cleanup removes the flag. No preview or
enumerated app-list data is logged or persisted by the viewer. Decryption never creates a missing
tenant key, and queue reads are serialized against tenant cleanup.

Run the checked-in configuration gate before any build:

```bash
npx pnpm@11.23.0 --filter @relay/mobile build-config:check
```

Run EAS commands from `apps/mobile`. Authenticate interactively, link the project to its approved
Expo owner, and keep the generated nonsecret EAS project ID in `app.config.ts`. Never commit an Expo
access token or Android keystore:

```bash
npx --yes eas-cli@22.3.0 login
npx --yes eas-cli@22.3.0 init
```

Configure these project-scoped plaintext values in the EAS `development` environment through the
Expo dashboard. They are embedded in the APK and therefore are not secrets:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Never create `EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY` or upload server credentials to EAS. Build each
profile only from a clean reviewed commit:

```bash
npx --yes eas-cli@22.3.0 build --platform android --profile development
npx --yes eas-cli@22.3.0 build --platform android --profile sideload
```

Development and sideload build URLs are internal artifacts. Share only with named testers. Before
distribution, inspect the development manifest to confirm SMS permissions are absent and the sideload
manifest to confirm both SMS permissions are present. Record build IDs, commit SHA, profile, package,
and tester owner in issue #10; never record credentials or source content.

Sources: [EAS profiles](https://docs.expo.dev/build/eas-json/),
[APK builds](https://docs.expo.dev/build-reference/apk/),
[monorepo builds](https://docs.expo.dev/build-reference/build-with-monorepos/), and
[build lifecycle hooks](https://docs.expo.dev/build-reference/npm-hooks/).
