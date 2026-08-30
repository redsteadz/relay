---
status: accepted
owner: mobile
last_verified: 2026-08-29
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
