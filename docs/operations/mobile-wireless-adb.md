---
status: accepted
owner: mobile
last_verified: 2026-10-31
---

# Mobile Wireless ADB

Relay requires a custom Expo build; Expo Go cannot load its native notification and SMS adapters.
See [Android notifications and SMS](../integrations/android.md) for the permission and privacy
boundaries.

## Pair A Physical Android Device

Connect the workstation and an Android 11 or newer phone to the same trusted Wi-Fi network. Enable
Developer options and Wireless debugging, then choose **Pair device with pairing code**. The pairing
port and connection port shown by Android are usually different.

```powershell
$env:Path += ";$env:ANDROID_HOME\platform-tools"
adb pair <phone-ip>:<pairing-port>
adb connect <phone-ip>:<wireless-debugging-port>
adb devices -l
```

Keep the phone unlocked during installation. On Xiaomi HyperOS, also enable **Install via USB** and,
when present, **USB debugging (Security settings)** under Developer options.

## Run Permission-Free Notification Diagnostics

From the repository root:

```powershell
corepack pnpm --filter @relay/mobile android:development:local
```

The command regenerates the ignored Android project, installs the development APK, and starts Metro.
In Relay, open **Sources**, choose allowed applications, confirm the disclosure, continue to Android
notification access, enable Relay, and turn off **Pause notification capture**. New matching
notifications appear only in the secure local queue and are not uploaded without a real session.

## Run Sideload SMS Diagnostics

```powershell
corepack pnpm --filter @relay/mobile build-config:check
corepack pnpm --filter @relay/mobile android:sideload:local
```

When ADB lists more than one target, append the exact ADB serial. The runner assigns it to
`ANDROID_SERIAL` before invoking Expo:

```powershell
corepack pnpm --filter @relay/mobile android:sideload:local -- DYMN7DO7FQRCDQMV
```

The sideload debug runtime opens without authentication but retains every SMS consent gate. In
**Sources > Android SMS**, choose at least one contact, review the selected contact list, confirm the
disclosure, tap **Grant access and sync** in the review dialog, and approve Android's SMS permission.
Matching inbox messages appear in **Encrypted SMS queue**. Nothing is uploaded in local diagnostic
mode.

The runner uses Expo Continuous Native Generation with `prebuild --clean` every time it switches
variants. This prevents SMS permissions or background components from leaking into a later
permission-free development build. Release sideload APKs still require authentication.

## Metro And Local Services

If the phone cannot reach Metro through the LAN, keep ADB connected and use port reversal:

```powershell
adb reverse tcp:8081 tcp:8081
corepack pnpm --dir apps/mobile exec expo start --dev-client --localhost
```

For a local API or Supabase instance, reverse only the ports actually in use and configure the mobile
public URLs as loopback URLs. `10.0.2.2` is an emulator alias and does not address the workstation
from a physical phone.

```powershell
adb reverse tcp:3000 tcp:3000
adb reverse tcp:55321 tcp:55321
```

Never inspect notification or SMS bodies through logs. The Sources screen is the approved local
preview surface and protects recent-task and screenshot output while previews are visible.

## Linux Workstation

The runner and commands above work unchanged on Linux once the toolchain is on `PATH`. Run them with
`corepack pnpm` from Bash or Zsh instead of PowerShell.

### Toolchain

React Native 0.86 recommends JDK 17, and Expo SDK 57 compiles against Android SDK Platform 36. Both
install under the home directory without root. Verify each download against the checksum its
publisher lists: the Adoptium API gives one for the Temurin 17 archive, and Google's repository
manifest gives one for the command-line tools. Unpack the JDK to `~/.local/share/jdk/17` and the tools
to `~/Android/Sdk/cmdline-tools/latest`, then:

```bash
export JAVA_HOME="$HOME/.local/share/jdk/17"
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
yes | sdkmanager --licenses
sdkmanager "platforms;android-36" "build-tools;36.0.0"
```

Gradle downloads the NDK and CMake it needs on the first build. When the distribution already ships
`adb` (for example Arch's `android-tools`), link it into the SDK instead of installing a second
`platform-tools`. Two different `adb` builds restart each other's server, which drops a wireless
pairing:

```bash
mkdir -p "$ANDROID_HOME/platform-tools"
ln -sfn "$(command -v adb)" "$ANDROID_HOME/platform-tools/adb"
```

### One Signing Key

The keystore in the generated project is React Native's public debug key. Any APK signed with it
can install over Relay and inherit notification access. Create one workstation keystore once and
pass it to every build. The runner copies it over the template key after prebuild:

```bash
umask 077
mkdir -p ~/.config/relay/android
keytool -genkeypair -keystore ~/.config/relay/android/relay-local.keystore -storetype PKCS12 \
  -storepass android -keypass android -alias androiddebugkey \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Relay Local Build"
export RELAY_ANDROID_KEYSTORE="$HOME/.config/relay/android/relay-local.keystore"
```

The alias and passwords are the ones the generated signing config expects. The protection is the
file's owner-only permission, not the password. A phone that holds an EAS build, or a build from
another workstation, must uninstall Relay once before the first local install. That deletes Relay's
local data on the phone. Every later build from this workstation installs in place.

### Signed-In Build Against Local Services

A debug sideload build otherwise opens local diagnostics without signing in. To test signed-in flows
such as saving a rule, run local Supabase, Pipeline and API, and build with diagnostics disabled.

Pick ports that are free on the workstation and reverse the same port on the phone. Without a
terminal, Expo does not prompt when the Metro port is taken: it skips Metro, and the app then loads
from whatever owns that port. Set `RCT_METRO_PORT` when 8081 is in use.

Start Supabase from the repository root:

```bash
RELAY_AUTH_SITE_URL=http://localhost:3000 \
RELAY_AUTH_WEB_REDIRECT_URL=http://localhost:8081/auth/callback \
pnpm exec supabase start
```

Keep backend values in an owner-only file, `~/.config/relay/local-backend/backend.env` (mode `600`),
with the same variables `scripts/local-e2e.mjs` generates. Use random values for
`RELAY_CREDENTIAL_KEK_KEYRING`, `RELAY_INGEST_SHARED_SECRET` and `RELAY_RECOVERY_SHARED_SECRET`. Set
`SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (the `SECRET_KEY`) and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (the `PUBLISHABLE_KEY`) from `supabase status -o json`. Then add
`RELAY_ENVIRONMENT=development` and `RELAY_PIPELINE_URL=http://127.0.0.1:8787`. Reuse the keyring
across restarts, because a new one strands every row encrypted under the old one.

```bash
D="$HOME/.config/relay/local-backend"
pnpm --filter "@relay/api^..." --filter "@relay/pipeline^..." build
pnpm --filter @relay/pipeline exec wrangler dev --config wrangler.e2e.jsonc \
  --env-file "$D/backend.env" --local --ip 127.0.0.1 --port 8787 --persist-to "$D/wrangler-state"
```

In a second terminal:

```bash
set -a; . "$HOME/.config/relay/local-backend/backend.env"; set +a
pnpm --filter @relay/api exec next dev --hostname 127.0.0.1 --port 3001
```

Reverse the ports, then build and install. Reverse mappings drop whenever wireless debugging
reconnects, so repeat them after a reconnect:

```bash
adb reverse tcp:8088 tcp:8088
adb reverse tcp:3001 tcp:3001
adb reverse tcp:55321 tcp:55321
RCT_METRO_PORT=8088 \
EXPO_PUBLIC_RELAY_LOCAL_DIAGNOSTICS=disabled \
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321 \
EXPO_PUBLIC_SUPABASE_ANON_KEY="<PUBLISHABLE_KEY>" \
EXPO_PUBLIC_API_URL=http://127.0.0.1:3001 \
corepack pnpm --filter @relay/mobile android:sideload:local -- <adb-serial>
```

Metro must keep running while the build is in use. JavaScript changes reload without another
native build.

### Signing In Locally

Local Auth delivers mail to Mailpit, never a real mailbox, and the app asks for a link only for an
existing account. Create one synthetic, confirmed account once:

```bash
set -a; . "$HOME/.config/relay/local-backend/backend.env"; set +a
curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H 'content-type: application/json' -d '{"email":"device-test@relay.test","email_confirm":true}'
```

Request a link in the app, then read it from Mailpit's API (the `MAILPIT_URL` in `supabase status`)
or its web page. Resolve the link on the workstation and hand the callback to the app. The app keeps
the PKCE verifier from its request, so only the code crosses the bridge:

```bash
CALLBACK="$(curl -s -o /dev/null -w '%{redirect_url}' '<verify-link-from-mailpit>')"
adb shell am start -a android.intent.action.VIEW -d "'$CALLBACK'" com.redsteadz.relay
```

`supabase db reset` deletes the account and everything the phone saved, so create it again after
each reset.

## Sources

- [React Native 0.86 environment setup, Linux and Android](https://reactnative.dev/docs/0.86/set-up-your-environment?os=linux&platform=android)
- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [Expo local development build setup](https://docs.expo.dev/get-started/set-up-your-environment/?platform=android&device=physical&mode=development-build&buildEnv=local)
