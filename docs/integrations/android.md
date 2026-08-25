---
status: accepted
owner: mobile
last_verified: 2026-08-24
sources:
  - https://docs.expo.dev/modules/overview/
  - https://support.google.com/googleplay/android-developer/answer/10208820
---

# Android Notifications And SMS

Expo local modules provide Kotlin access unavailable in Expo Go. Relay uses a custom development or
sideload APK and Continuous Native Generation.

`NotificationListenerService` can observe posted notifications after user grants system listener
access. Capture must support app allowlists, field minimization, encrypted offline queue, server
acknowledgement, and explicit revocation. Source cancellation is irreversible from Relay's point of
view and follows the stronger gates in [action model](../architecture/action-model.md).

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
