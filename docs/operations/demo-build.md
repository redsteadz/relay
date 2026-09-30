---
status: accepted
owner: mobile
last_verified: 2026-09-30
---

# Demo Build

A sideloadable Android build that shows every Relay surface without an account, a network, or a
phone that happens to receive an interesting notification while someone is watching. It exists for
demonstrations only. It is never a release channel and never talks to a Relay environment.

## What It Replaces

Demo mode is a build flag, `EXPO_PUBLIC_RELAY_DEMO=enabled`, read once by `lib/demo/mode.ts`. Metro
inlines `EXPO_PUBLIC_*`, so an ordinary build carries no truthy value and every branch guarded by it
collapses to the real path.

Three seams are replaced, and nothing else:

| Seam                               | Replaced by                  | Why it cannot be real                                                                      |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------ |
| `lib/auth-configuration.ts` client | `lib/demo/client.ts`         | No Supabase project, no session, no row-level security to enforce                          |
| `lib/relay-api.ts` transport       | `lib/demo/relay-api.ts`      | No hosted API to answer `/api/privacy`, `/api/connectors/openai` or `/api/filters/compile` |
| `modules/relay-device-ingress`     | `lib/demo/device-ingress.ts` | A notification listener needs an Android grant and a real notification to hear             |

Everything above those seams is the shipped code. Facts come from `normalizeSourceFacts`, events from
`extractSourceEvents`, plans from `compileFilterPlan`, and filing from `classifyCapture` -- the same
pure functions the pipeline and the device pass call. A demo capture is therefore derived, filed and
explained exactly as a real one would be.

The device stand-in also hears notifications and holds a capture queue: `demoPostNotification`
applies the listener's gates and policy and queues a native-shaped envelope. The device-boundary
harness ([local harness](../architecture/data-flow.md#device-boundary)) installs the same stand-in in
place of the native module. A demo build still never uploads what it queues, because
`syncDeviceCaptures` returns before anything is registered or sent.

## What It Holds

`lib/demo/seed.ts` builds one synthetic account: twelve categories, six rule series (one with two
revisions and one paused), eleven captures spread over the last six hours, the classifications those
rules produce, an action ledger with a succeeded, a cancelled and a failed run, an audit trail, and
two disclosure records. It is deterministic, so every install opens on the same account. The
document lives in AsyncStorage under `relay.demo.tables.v1` and is rebuilt by **Reset the demo
account** in the Demo studio.

## The Demo Studio

Reached from the flask in the inbox header, or from Settings. The entry point is deliberately an
icon rather than a banner: the inbox is the thing being demonstrated, and a card across the top of
it displaces the receipts a person is meant to be reading. It generates captures: nine
scenarios chosen so the inbox reaches every outcome it can show -- something waiting on a decision, a
contradiction Relay refuses to resolve, something filed quietly, something no rule claims, and a
capture this device cannot read the body of -- plus a composer for arbitrary text and a five-capture
burst. Each send reports the classification it actually got, including the reason when nothing
claimed the capture.

## Honest Limits

- Demo mode calls no provider. An approved action is recorded as succeeded because that is what a
  Workflow would have reported; nothing is sent to Google Tasks, Nextcloud or a webhook.
- No API key is stored, only the fact that one was submitted.
- SMS and notification access report as available without an Android grant, because the demo answers
  the capability itself.
- Sign-in accepts any address and completes immediately. There is no mailbox and no magic link.

The Demo studio states the first of these on screen. Do not present a demo build as evidence that an
integration works.

## Building It

```bash
pnpm --filter @relay/mobile demo:android
```

Continuous Native Generation is authoritative, so the script runs `expo prebuild --clean` before
Gradle: switching variants otherwise leaves the previous one's permissions in the manifest. The
result is `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, signed with the Expo
template debug keystore, which is sufficient for sideloading and unacceptable for distribution.

The build sets `EXPO_PUBLIC_RELAY_DEMO` in the process environment rather than in a `.env` file.
Expo does not override a variable that is already set, and a committed `.env.local` carrying this
would silently turn every local build into a demo build.

Related: [Cloudflare operations](cloudflare.md), [Supabase operations](supabase.md),
[Mobile wireless ADB](mobile-wireless-adb.md).
