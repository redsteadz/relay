---
name: web-preview
description: Launch the Relay mobile app on web in demo mode and drive it with a headless browser to screenshot screens, measure layout overflow, and catch runtime errors. Use for any UI, layout, styling or animation change in apps/mobile, to see the change on screen instead of guessing - no Android SDK, device or account needed.
---

# Web preview of the mobile app

`apps/mobile` is an Expo app that also renders on web through `react-native-web`, and demo mode
(`EXPO_PUBLIC_RELAY_DEMO=enabled`) swaps the account, network and device capture for local
synthetic data. Together they give a full UI loop without a native build: start the web dev server,
drive it at phone size, edit, re-shoot.

**What it is faithful for:** layout, spacing, colour, typography, hierarchy, copy, most motion.
**What it is not:** native-only surfaces (notification capture, the RevenueCat paywall and Customer
Center, permission prompts) and native animation timing. Check those on a dev-client build.

## 1. Start the dev server

From `apps/mobile`, in the background:

```bash
EXPO_PUBLIC_RELAY_DEMO=enabled BROWSER=none npx expo start --web --port 8081
```

Wait for it to serve - the first bundle takes 20-90s:

```bash
timeout 180 bash -c 'until curl -sf http://localhost:8081 >/dev/null; do sleep 2; done'
```

**Do not set `CI=1`.** It makes Expo non-interactive, but it also turns off Metro's file watching,
so edits never reach the browser and every re-shoot silently shows old code. If a change seems to
have no effect, check for this first, then restart with `--clear`.

Stop it by killing whatever listens on 8081 (on Windows:
`Get-NetTCPConnection -LocalPort 8081 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`).

## 2. One-time driver setup

The scripts use `playwright-core` installed outside the repo, so it is not a workspace dependency:

```bash
npm install --prefix "$(node -p 'require("os").tmpdir()')/relay-web-preview" playwright-core@1
```

They drive an installed Edge or Chrome (`RELAY_PREVIEW_BROWSER` overrides the path). With neither
installed, run `npx playwright install chromium` once.

## 3. Drive it

All scripts live in `.claude/skills/web-preview/scripts/`. Output goes to
`<tmpdir>/relay-web-preview/` (override with `RELAY_PREVIEW_DIR`).

```bash
S=.claude/skills/web-preview/scripts
node $S/probe.mjs                          # off-screen controls + runtime errors, every screen
node $S/shoot.mjs                          # screenshot every screen, dark
node $S/shoot.mjs --scheme light           # ...and light
node $S/shoot.mjs --route /inbox --name inbox-after   # one screen while iterating
node $S/sheet.mjs --prefix dark-1 --out tabs.png      # tile into one image to review
```

Then **look at the images** (Read the PNG). A rendered frame is the evidence; a script exiting 0 is
not. `probe.mjs` exits non-zero if any button or link sits past the right edge, or a page error is
thrown - run it after any layout change, because an off-screen control looks like an absent one in
a screenshot.

The route list is in `scripts/lib.mjs`. Update it when screens are added or moved.

## 4. The iteration loop

1. `probe.mjs` + `shoot.mjs` before touching anything, as the baseline.
2. Edit. Metro rebuilds the one changed module in about a second.
3. `shoot.mjs --route <screen>` and look at it; `probe.mjs --route <screen>` for overflow.
4. Before committing, re-run the full `shoot.mjs` in both schemes and compare against the baseline -
   shared primitives in `components/ui` and tokens in `theme` change every screen at once.

## Gotchas found on the way

- **Onboarding.** A fresh browser context lands on `/onboarding`. The scripts click through it; the
  final button is **Open inbox**, not Continue. State is kept in localStorage per context.
- **Git Bash on Windows** rewrites a leading `/` argument into a Windows path
  (`/inbox` -> `C:/Program Files/Git/inbox`). Prefix commands that pass routes with
  `MSYS_NO_PATHCONV=1`.
- **`flex: 0` means different things.** Native reads it as "size to content"; react-native-web
  compiles it to a zero flex-basis, collapsing the element to no width. Use `flexShrink: 0` for a
  slot that should keep its content size. This is what pushed header actions off-screen on web.
- **Full-page screenshots are not.** Screens scroll inside a `ScrollView`, so a screenshot is always
  the viewport. Scroll the inner view, or check content further down on its own route.
- **Known noise, not regressions:** a 404 for `/sources` (it redirects to `/sources/gmail`); a
  react-dom warning on `/connections` that a `<button>` is nested inside a `<button>` (a pressable
  source card containing a pressable info button); RevenueCat logging "Preview API Mode" on web.
- **pnpm.** Use `npx expo`, not `pnpm`. If `pnpm` is not on PATH and a tool needs to spawn it
  (`expo install`), put a wrapper around `npx --yes pnpm@<packageManager version>` on PATH.
