---
status: accepted
owner: mobile
last_verified: 2026-08-28
sources:
  - https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi
  - https://developer.android.com/studio/run/device
  - https://docs.expo.dev/guides/local-app-development/
  - https://docs.expo.dev/more/expo-cli/
---

# Run Relay On Android With Wireless ADB

This guide builds Relay's Expo development client on a physical Android phone and keeps it connected
to Metro without a USB cable. Relay contains a local native module, so use the development build in
this guide rather than Expo Go. The development build deliberately excludes SMS permissions; use the
reviewed `sideload` EAS profile described in [Android integration](../integrations/android.md) when
testing SMS capture.

The commands below use PowerShell from the repository root.

## Prerequisites

- Install Node.js 22.23.2 and Android Studio.
- In Android Studio's SDK Manager, install an Android SDK and Android SDK Platform-Tools.
- Make `adb` available on `PATH`. Its usual Windows location is
  `%LOCALAPPDATA%\Android\Sdk\platform-tools`.
- Use Android 11 or newer for pairing-code wireless debugging.
- Connect the computer and phone to the same Wi-Fi network.
- On the phone, enable **Developer options** and **Wireless debugging**. USB debugging is needed only
  for the Android 10-and-older fallback at the end of this guide.

Confirm the tools and install the workspace dependencies:

```powershell
node --version
adb version
npx pnpm@11.23.0 install
npx pnpm@11.23.0 --filter @relay/mobile build-config:check
```

Do not continue until `adb version` succeeds. If PowerShell was already open when `PATH` changed,
close and reopen it.

## Pair And Connect The Phone

On the phone, open **Settings > Developer options > Wireless debugging** and choose **Pair device
with pairing code**. Android displays an IP address, pairing port, and six-digit code. Enter the
displayed pairing endpoint on the computer:

```powershell
adb pair 192.168.1.50:37123
```

Enter the pairing code only at the interactive prompt. Do not put it in a script, screenshot, issue,
or committed file.

Return to the main **Wireless debugging** screen. Use the separate IP address and port shown there to
connect:

```powershell
adb connect 192.168.1.50:43215
adb devices -l
```

The pairing port and connection port are usually different. Continue only when `adb devices -l`
lists the endpoint with state `device`, not `offline` or `unauthorized`. Save the endpoint for the
remaining commands:

```powershell
$relayDevice = "192.168.1.50:43215"
```

Pairing is normally remembered, but the connection port can change after Wi-Fi or wireless debugging
restarts. In later sessions, read the current endpoint from the phone and run `adb connect` again.

## Configure Local Application Values

Copy the repository's `.env.example` to an untracked root `.env` and replace its placeholders with
the output from the local Supabase stack. Never add server credentials to an `EXPO_PUBLIC_` variable.

Create an untracked `apps/mobile/.env.local` containing only the mobile public values:

```dotenv
EXPO_PUBLIC_API_URL=http://127.0.0.1:3000
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<local-publishable-or-anon-key>
```

Expo embeds `EXPO_PUBLIC_` values in the app bundle. A Supabase publishable/anon key is appropriate;
a service-role key, access token, password, or Relay encryption key is not.

Start the local services in separate PowerShell windows:

```powershell
npx pnpm@11.23.0 supabase:start
```

```powershell
npx pnpm@11.23.0 --filter @relay/pipeline dev
```

```powershell
npx pnpm@11.23.0 --filter @relay/api dev
```

Forward the phone's loopback ports through wireless ADB to the computer. This lets the app use the
same `127.0.0.1` endpoints as local development without exposing the services to the Wi-Fi network:

```powershell
adb -s $relayDevice reverse tcp:3000 tcp:3000
adb -s $relayDevice reverse tcp:55321 tcp:55321
adb -s $relayDevice reverse tcp:8081 tcp:8081
adb -s $relayDevice reverse --list
```

ADB reverse rules disappear when the device disconnects, so repeat these commands after reconnecting.

## Build, Install, And Open Relay

Keep the phone unlocked, then build and install the development client:

```powershell
npx pnpm@11.23.0 --dir apps/mobile exec expo run:android --device $relayDevice
```

The first run generates the ignored native Android project, compiles it, installs the APK, starts
Metro, and opens Relay. Accept Android's debugging prompt if one appears. Do not commit the generated
`apps/mobile/android/` directory.

For normal JavaScript or TypeScript work after the first native build, keep the installed client and
start only Metro:

```powershell
npx pnpm@11.23.0 --dir apps/mobile exec expo start --dev-client --localhost
```

Open Relay on the phone. If Expo shows its terminal menu instead, press `a` to open the connected
Android app. Changes should then reload without rebuilding the APK.

Re-run `expo run:android` after changing `app.config.ts`, native module Kotlin or manifest files,
native dependencies, or the Expo SDK. A JavaScript, TypeScript, or styling change needs only Metro.

## LAN Fallback

If `adb reverse` is unavailable, use the computer's active Wi-Fi IPv4 address instead. Set that
address in both mobile URLs, for example `http://192.168.1.20:3000` and
`http://192.168.1.20:55321`, start Metro with `--lan`, and allow Node.js, Metro, and Supabase through
Windows Firewall on private networks only:

```powershell
npx pnpm@11.23.0 --dir apps/mobile exec expo start --dev-client --lan
```

Do not use `10.0.2.2` on a physical phone; that address is the Android emulator's alias for the host
computer.

## Troubleshooting

### `adb` is not recognized

Add Android SDK Platform-Tools to `PATH`, open a new PowerShell window, and retry `adb version`.

### Pairing succeeds but the device does not appear

Use the connection endpoint from the main Wireless debugging screen, not the temporary pairing
endpoint. Confirm both devices are on the same Wi-Fi, disable VPNs temporarily, and check whether the
network blocks client-to-client traffic. Toggle Wireless debugging off and on if Android assigned a
new port.

### Device is `offline` or `unauthorized`

Disconnect only the saved device, forget the computer under the phone's paired devices, and pair it
again:

```powershell
adb disconnect $relayDevice
```

### Relay opens but cannot load JavaScript or backend data

Confirm the device is still connected and restore all three reverse rules. Confirm Metro, the API,
and Supabase are listening on ports 8081, 3000, and 55321 respectively. Restart Metro after changing
an `EXPO_PUBLIC_` value.

### More than one Android device is connected

Always pass the exact endpoint with `-s $relayDevice` to ADB and with `--device $relayDevice` to Expo.
This prevents installing or forwarding ports on the wrong phone.

## Android 10 And Older

Older Android versions require a one-time USB connection for TCP/IP mode. With the intended phone as
the only attached USB device, run `adb tcpip 5555`, find the phone's Wi-Fi IP address, unplug USB, and
run `adb connect <phone-ip>:5555`. The build, reverse, and Metro steps above are otherwise the same.

See Android's official [wireless ADB instructions](https://developer.android.com/tools/adb#connect-to-a-device-over-wi-fi)
and Expo's [local app development guide](https://docs.expo.dev/guides/local-app-development/) for
platform-level details.
