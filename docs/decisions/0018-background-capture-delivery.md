---
status: accepted
date: 2026-10-05
owners: maintainers
---

# ADR-0018: Background Capture Delivery

## Context

A notification arrives precisely when the app is not open — that is what a notification is. Capture
already survives that: `RelayNotificationListenerService` is bound by the system, so the encrypted
queue fills with the app dead. Delivery did not. `syncDeviceCaptures` ran on mount and on `AppState`
becoming `active`, and nothing else, so a capture waited in the queue for an unrelated event: the
person happening to open Relay. Until then it was absent from the inbox, unclassified by the
pipeline, and invisible to every rule the reader wrote. The queue expires items seven days after
capture, so a reader who did not open the app for a week lost them, having done nothing wrong and
been told nothing ([#182](https://github.com/redsteadz/relay/issues/182)).

[ADR-0014](0014-device-local-classification.md) recorded the cause plainly: "There is no background
JavaScript runtime in the app, so a capture that arrives while the app is closed is filed on the next
open." That is the constraint this decision removes.

`RelaySmsSyncJobService` is the nearest precedent, but it is not the same problem. It moves provider
rows into the queue, entirely in Kotlin. Delivery is the opposite shape: it needs the Supabase
session, `registerInstallation`, the ingest contract, request-ID propagation, and the derivation pass
— all of which live in TypeScript. A native job would have to either reimplement the upload path or
reach into `expo-secure-store` for a bearer token from Kotlin. Two upload paths to keep in step, or a
credential read outside the runtime that owns it; neither is the smallest correct change.

## Decision

Delivery runs in a headless JavaScript task. `expo-background-task` registers a WorkManager job that
calls the existing `syncDeviceCaptures`, so there is exactly one upload path and the background run
is the foreground run with a different trigger.

The behaviour is a flag the reader controls, not a default. Consent to notification access covers
capture; a fair reading covers delivery, but "fair reading" is not the standard Relay holds itself
to, so background delivery is opt-in, described in plain language on the Sources screen, and
revocable there. Turning it off unregisters the task rather than leaving it registered and
short-circuiting, so a reader who declines has no background work scheduled at all.

Latency is accepted rather than fought. WorkManager's floor is a fifteen-minute inexact interval, and
Doze and app-standby buckets stretch it further. Relay therefore promises that a capture arrives
without the app being opened, never that it arrives immediately, and the UI says so. Relay does not
request a battery-optimization exemption and does not run a foreground service: a permanent
notification is the wrong thing for a product whose premise is a quieter phone.

A background run with no session records that and stops. It does not retry into a loop, and it does
not treat a missing session as a failure to report — a signed-out phone having nothing to upload is
the expected state, not an incident.

The task is registered only where it can work. Demo mode queues nothing, the web build has no
WorkManager, and a device with capture paused has nothing to deliver, so registration is gated on the
same capability read the foreground sync already performs.

## Consequences

- The consequence recorded in ADR-0014 is amended: there is now a background JavaScript runtime, and
  it runs the derivation pass before upload exactly as the foreground path does. A capture arriving
  while the app is closed is filed without waiting for an open, within WorkManager's latency.
- Delivery can now fail where nobody is watching. Every exit from the background run is logged
  through `logMobileError` with a fixed event, because a silent background failure is strictly worse
  than a silent foreground one — there is no person present to notice nothing happened.
- `expo-background-task` and `expo-task-manager` are added to the mobile app. Both are Expo-owned and
  work under Continuous Native Generation, so the generated `android/` directory stays ignored. The
  package's config plugin is deliberately **not** applied: everything it does is iOS
  (`UIBackgroundModes`, `BGTaskSchedulerPermittedIdentifiers`), and Android needs no manifest entry
  because WorkManager declares its own. An iOS build that ever wants this task has to add the plugin
  and will not get background delivery silently until it does.
- Seven-day queue expiry stops being a quiet data-loss path for readers who open the app rarely. It
  remains the bound for a device that is offline or signed out for that long.
- This does not change what is uploaded, only when. No new field, payload, or identifier reaches the
  network, so the privacy surface is unchanged and the raw-payload lifecycle is untouched.
- Relay still does nothing while the device has no network. WorkManager's network constraint means
  the run is deferred rather than attempted and failed.

## References

- [Android notifications and SMS](../integrations/android.md)
- [End-to-end data flow](../architecture/data-flow.md)
- [Privacy and data lifecycle](../security/privacy.md)
- [ADR-0014: Device-local classification](0014-device-local-classification.md)
- [`expo-background-task`](https://docs.expo.dev/versions/latest/sdk/background-task/)
- [WorkManager constraints](https://developer.android.com/topic/libraries/architecture/workmanager)
