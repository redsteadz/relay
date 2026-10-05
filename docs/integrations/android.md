---
status: accepted
owner: mobile
last_verified: 2026-10-05
sources:
  - https://docs.expo.dev/modules/overview/
  - https://developer.android.com/training/package-visibility/declaring
  - https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE
  - https://support.google.com/googleplay/android-developer/answer/10208820
  - https://developer.android.com/reference/android/service/notification/NotificationListenerService
  - https://developer.android.com/reference/android/provider/Settings#ACTION_APP_NOTIFICATION_SETTINGS
  - https://docs.expo.dev/versions/latest/sdk/background-task/
---

# Android Notifications And SMS

Expo local modules provide Kotlin access unavailable in Expo Go. Relay uses a custom development or
sideload APK and Continuous Native Generation.

`NotificationListenerService` can observe posted notifications after user grants system listener
access. Capture must support app allowlists, field minimization, encrypted offline queue, server
acknowledgement, and explicit revocation. Source cancellation is irreversible from Relay's point of
view and follows the stronger gates in [action model](../architecture/action-model.md).

Relay cannot stop a notification ringing; it can only clear one that has already rung. See
[Acting On A Notification](#acting-on-a-notification).

Relay skips a notification carrying `FLAG_GROUP_SUMMARY`. A grouped app must post a summary beside
its children; that summary only aggregates content the children already carry and is rewritten
whenever a child arrives, so capturing it duplicates observations without adding signal.

The notification envelope UUID is deterministic over the posting package, Android's notification key,
and a SHA-256 fingerprint of the visible title and text. Package name namespaces the key so equal
keys from different apps cannot collide. Unlike an SMS provider row, a notification key names a
mutable slot rather than a fixed record: Android reuses one key while rewriting the notification in
place. Identity over the key alone therefore returned an edited notification to the pipeline under an
existing envelope ID carrying different facts, which deduplication rejects as
`fact_integrity_conflict`. Including content keeps an unchanged redelivery idempotent and makes an
edit its own observation. Post time is excluded so retrying one unchanged notification cannot mint a
second identity, and two notifications sharing a key and visible content deduplicate to one capture.

A notification is captured by two routes, deciding by one policy. `onNotificationPosted` delivers
only what is posted while the listener is bound, so anything that arrived while it was unbound -- an
app update, a reboot, process death, the system rebinding the service -- was observable in the shade
and never captured. On connect, Relay therefore sweeps `getActiveNotifications` and offers each one
to the same gates. Re-offering is safe because identity ignores when a capture happened: an unchanged
notification produces the identity it produced before, so the queue keeps the original row and its
retry history and the pipeline recognises a redelivery. A capture the server already acknowledged has
no queue row left to recognise it by, so the sweep also consults retained content, which is keyed by
the same envelope UUID and outlives the queue. Losing that record is bounded and safe: the capture is
offered again under an unchanged identity and deduplicates server-side.

Extraction reads `sender` and the structured `attributes` map. It does not read `subject` or `body`,
and [ADR-0010](../decisions/0010-fact-only-event-extraction.md) records why: those are free text no
adapter has interpreted, and deriving facts from them would make extraction less private and less
deterministic. The notification adapter therefore reports `attributes.sender` only when Android has
structurally identified one through `MessagingStyle`, and reports nothing when a notification carries
nothing structured. The notification title is never reported as a sender; it is the headline every
notification has, not a party the posting application named.

What a capture said therefore stays on the device that captured it. Beside the upload queue, and
under the same per-tenant Keystore key, the adapter keeps a minimized copy of the visible title and
text. It is stored separately from the queue so acknowledging an upload does not also remove the
tenant's ability to read what was captured, and it is bounded by storage rather than by the server's
raw-payload deadline: thirty days, 2000 items, and 4 MiB per tenant, oldest dropped first. The
inbox reads it through `getRetainedCaptureContent` for a prepared tenant, decrypting on demand, and
never writes it to logs, JavaScript storage, or the network. A row that fails to decrypt is deleted
rather than guessed at.

The native capture queue stores only AES-256-GCM ciphertext in SQLite. Its per-tenant key is
non-exportable Android Keystore material, and tenant/envelope identity is authenticated as associated
data. Capture adapters assign the envelope UUID once before enqueueing. The queue retains that UUID
across process restarts and retries, expires items seven days after capture, and enters an explicit
failed state for terminal responses or exhausted retries. It is bounded to 500 items and 2 MiB per
tenant. A device item is deleted only when `/api/ingest` returns `202` with a validated
`{ accepted: true, durable: true, id }` acknowledgement for the same envelope. Sign-out and device
revocation delete the Keystore key before deleting tenant rows, so an interrupted clear cannot leave
decryptable source data.

Capture survives a closed app; delivery used to not. The listener is bound by the system, so the
encrypted queue fills whether or not Relay is running, but `syncDeviceCaptures` ran only on mount and
on `AppState` becoming `active`. A capture therefore waited for the reader to open Relay, and the
queue expires items seven days after capture, so a reader who did not open the app for a week lost
them silently. Delivery now also runs from a WorkManager-backed headless JavaScript task
(`expo-background-task`) calling the same `syncDeviceCaptures`, so there is one upload path with two
triggers. It is opt-in, described on the Sources screen, and unregistered rather than short-circuited
when switched off. WorkManager's floor is a fifteen-minute inexact interval and Doze stretches it
further, so the promise is delivery without opening the app, never immediate delivery. A background
run with no session records that and stops rather than retrying. Relay requests no battery-optimization
exemption and runs no foreground service. See
[ADR-0018](../decisions/0018-background-capture-delivery.md).

`READ_SMS` and `RECEIVE_SMS` are sensitive Google Play permissions. Google documents possible
exceptions for device automation and SMS-based money management, subject to review. MVP therefore
uses sideload distribution and prominent consent. Non-SMS builds remain an architectural
requirement for later Play distribution.

## Acting On A Notification

**Relay cannot stop a notification making a sound, and no permission a user can grant will change
that.** `onNotificationPosted` is delivered after the system has ranked, posted and alerted, so by
the time Relay sees a notification the phone has already rung. The listener's entire mutation surface
is `cancelNotification`, `snoozeNotification`, `cancelAllNotifications`, `setNotificationsShown` and
`requestInterruptionFilter`: remove it, hide it for a while, remove everything, mark it seen, or
change device-wide Do Not Disturb. None of those is per-notification and pre-alert.

The pre-posting hook, `NotificationAssistantService.onNotificationEnqueued` returning an `Adjustment`
with `KEY_IMPORTANCE`, is `@SystemApi`. Neither class is in the public `android.jar` an app compiles
against — verified against `android-36`, whose `android/service/notification/` package contains
`NotificationListenerService`, `StatusBarNotification`, `ConditionProviderService`, `ZenPolicy` and
`Condition`, and neither of the two a pre-posting adjustment needs. A sideloaded app cannot implement
one.

So an authorized rule does one of two things, both after the fact:

| Action    | Call                          | Effect                                               | Reversible |
| --------- | ----------------------------- | ---------------------------------------------------- | ---------- |
| `snooze`  | `snoozeNotification(key, 2h)` | Removed from the shade; Android brings it back later | Yes        |
| `dismiss` | `cancelNotification(key)`     | Cancelled; nothing brings it back                    | No         |

`snooze` is what a newly reviewed rule gets, because a rule just out of its observation window is the
one most likely to still be wrong and a two-hour delay is recoverable where a cancellation is not.
The first matching rule decides, in snapshot order, whatever its action — one verdict per
notification, mirroring how one rule claims a capture.

Where Relay cannot act, it hands over the control that can. The quiet screen lists the applications
the tenant's own rules name and opens each one's Android notification settings
(`ACTION_APP_NOTIFICATION_SETTINGS`), which is the only thing on the device that stops the sound.

Which of the two a rule does is chosen when its dry run starts, as two separate controls rather than
one with a default: the choice between reversible and not is the whole decision. Changing it restarts
the window.

**Authorization lives beside the revision, not on it.** A filter revision is immutable --
`filter_rules_enforce_immutability` refuses every update to `filter_rules` -- so the original
`dismiss_source_notification` and `dismissal_dry_run_completed_at` columns could never have been
written after insert, which is the likeliest reason nothing ever read them. They are dropped.
`notification_dismissal_authorizations`, keyed by `(user_id, filter_rule_id)`, holds the action, the
window, the evidence and `authorized_at`, the same way `hidden_inbox_events` sits beside
`relay_events`. Keying it to a revision rather than a series makes withdrawal on edit automatic.

**Authorization is the database's; the device holds a cache.** A rule may act only when
`authorized_at` is set, and the only writers are `start_notification_dismissal_dry_run_v1`,
`complete_notification_dismissal_dry_run_v1` and `set_notification_dismissal_v1`. They validate the
deterministic plan, the absence of a semantic clause, and an explicit `source.applicationId`
predicate that every satisfying assignment of the expression passes through; they measure the dry-run
window on the server clock between two calls; and each writes `audit_log` in the same statement. The
app writes the resulting snapshot natively with a monotonic revision, so a sync that loses a race
cannot reinstate withdrawn authorization.

**What the device may evaluate is narrower than what a rule may say.** The decision runs in a
system-bound process with the app dead, holding a `StatusBarNotification` and nothing else, so
`compileNotificationSilenceRule` flattens a plan into a bounded disjunction of literal tests over
`source.applicationId`, `source.kind` and `subject` — the fields reliably present at that moment. It
refuses negation, `sender`, `body`, `category`, `attributes.*`, and anything exceeding 16 clauses or
16 tests per clause, each with a reason the UI states. Text comparison mirrors `evaluateFilterPlan`
exactly — NFKC, collapse the JavaScript `\s` class, trim, lowercase `en-US` — and both suites assert
the same vectors. A rule can be authorized server-side and still refused here; that is reported
rather than hidden.

Scope is the capture allowlist intersected with the applications a rule names. A notification no rule
names is never evaluated and never recorded, so the ledger cannot become a log of every app a person
uses.

The dry-run ledger is device-local, plaintext and content-free: application id, rule id, capture
identity, verdict, time. No title, no text, no sender, and it is never uploaded. It is bounded to
1000 rows and thirty days, oldest dropped first, and keyed by the capture identity the same function
derives for the capture — which is what makes an outcome reviewable against an item a person
recognises. The verdict is written **before** the notification is touched: afterwards the row is the
only remaining evidence, so a crash between the two leaves a record of an act that did not happen
rather than an act with no record.

Three stops, all immediate. A tenant-wide kill switch stored apart from the snapshot so engaging it
is one preference write that waits on nothing; a per-application pause; and revoking listener access,
which unbinds the service. A matched rule that is not acted on is recorded as `declined`, so a stop
is distinguishable from the rule having stopped matching. Editing a rule writes a new revision with
authorization withdrawn, because the evidence a person reviewed was evidence about the rule as it was
written then.

Hiding an inbox row (`hidden_inbox_events`) is none of this. It removes a row from Relay's own inbox
and never touches the device. `features/inbox/models/dismissalBoundary.test.ts` asserts structurally
that no inbox surface can reach the cancel or snooze capability, and that nothing in the module
reaches for the pre-posting hook, so neither can be acquired by accident. See
[ADR-0017](../decisions/0017-notification-dismissal-after-posting.md).

## Sideload SMS Capture

SMS capture is capability-driven and inbox-only. The Sources screen reports the build variant,
whether the APK actually declares both SMS permissions, whether Android currently grants both, the
capture pause state, exact sender allowlist, and encrypted SMS queue count. Relay shows a persistent
disclosure before its consent checkbox and permission action. It configures capture as paused before
opening Android's runtime prompt without flipping the visible user control, and enables it only if
both permissions are granted. Capability refreshes are ordered so a stale pre-permission snapshot
cannot turn the pause control back on after a successful enable.

Relay queries only `Telephony.Sms.Inbox.CONTENT_URI` and allowlists the `_ID`, `ADDRESS`, `BODY`, and
`DATE` columns. It does not query sent messages or the general SMS collection. Sender entry can open
Android's system phone-number picker, which grants Relay temporary access to only the selected phone
row; Relay does not request `READ_CONTACTS` or enumerate the contacts database. The selected number
remains a draft in the review dialog until save commits an exact normalized snapshot to the native
allowlist. Paused saves stop there; active saves then run a best-effort inbox sync. After the allowlist
commit, the configured selection remains visible in the review dialog if sync fails, and cancel or
back does not roll it back. Relay reports that contacts were saved but existing inbox sync failed;
Retry reruns inbox sync without changing the allowlist. Canceling still discards uncommitted draft
edits. There is no manual sender text field. Phone-like senders are compared after removing visual
separators. On devices whose SIM, network, or locale country is Pakistan, known equivalent mobile
forms such as `+923001234567`, `03001234567`, and `923001234567` canonicalize to the same `+92` value
before exact comparison; unrelated short/nonnumeric senders are not fuzzily matched. Alphanumeric
sender IDs are compared case-insensitively. At least one exact sender is required. The first consented
sync reads inbox rows oldest-first and considers matching inbox rows until the encrypted queue's
existing 500-item/2-MiB bound is reached. Later syncs use the highest observed provider `_ID` as a
cursor. Changing the normalized sender set resets that cursor so previously skipped rows can be
reconsidered under the new explicit allowlist; stable envelope IDs and queue deduplication prevent
duplicate captures.

Provider `_ID` is the source `externalId`. The envelope UUID is deterministic over `sms`, a random
installation-local source account UUID, and that provider ID. This prevents retries or a broadcast
follow-up from changing identity and prevents equal row numbers on two phones from colliding. The
`SMS_RECEIVED` receiver never treats broadcast PDU content as a durable record; it schedules a short
provider follow-up, which creates envelopes only after the message has a provider ID. Foreground and
app-resume sync uses the same reader and identity path.

Every provider query and cursor iteration rechecks both permissions. A missing or revoked permission
persistently pauses capture before returning, so restoring permission does not silently resume reads.
The receiver and scheduled job also exit before access when capture is paused, configuration is
absent, or permission is missing. Users can pause before new reads and can delete only queued SMS;
notification queue rows and the shared Keystore key remain intact.

Debug sideload builds emit content-free diagnostics for receiver entry, declaration/grant state,
configuration presence, pause state, scheduling result, and job failures. These diagnostics never
include sender, body, broadcast PDU data, or decrypted queue content. The receiver ignores PDU
content and only schedules the protected, non-exported `JobService`; the service always calls
`jobFinished` in `finally` once asynchronous work begins.

The reusable local module manifest contains no SMS permission, receiver, or job-service declaration.
`app.config.ts` is the sole flavor boundary: the `sideload` variant adds `READ_SMS`, `RECEIVE_SMS`,
the protected SMS receiver, and its non-exported job service; `development` blocks both permissions
and adds neither component. A later Play-safe profile must extend the permission-free branch rather
than modifying the module manifest. The checked-in build gate verifies both public configs and fails
if SMS permissions return to the reusable manifest.

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

Only a JavaScript debug runtime may enter the app without authentication. On Android, both internal
variants use a stable synthetic tenant for this local diagnostic path. The permission-free
`development` variant can diagnose notifications; the `sideload` variant can diagnose notifications
and SMS after the same disclosure, sender allowlist, and Android runtime consent required outside
diagnostics. Release sideload builds still require authentication. Local mode never invokes capture
sync or uploads without a real session. An unauthenticated local startup preserves its encrypted
queue for diagnostics. A real session, or any startup where local access is unavailable, deletes the
synthetic key, queue, and source configuration before refreshing capabilities or starting
authenticated sync. Authenticated controls therefore require a fresh disclosure and configuration.
Native tenant preparation also clears a different previously configured tenant before local or
authenticated capture begins, including after unexpected session loss. Navigation and authenticated
sync remain blocked until native tenant preparation succeeds. Generation ordering prevents
superseded authentication transitions from mutating current capture keys, queues, or configuration.
Native queue and configuration methods also reject tenant IDs and preparation generations that do
not match the latest prepared auth epoch.

Notification source selection queries only activities declaring the launcher intent through an
explicit package-visibility `<queries>` entry. Relay does not request `QUERY_ALL_PACKAGES`. Installed
app labels and the complete launchable-app list remain on device and are never logged or uploaded.
For authenticated captures, the selected package ID becomes `source.applicationId` provenance and is
uploaded only with a captured envelope.

Development-local diagnostics decrypt ready queue entries in pending state inside the Kotlin module,
parse them natively, and bridge only source-specific minimized fields plus non-content queue metadata
to the focused viewer. Notification previews include sender, subject, body, application ID, and
capture time. Sideload SMS previews include sender, body, and capture time. Both include stable
capture envelope ID and retry-attempt count for navigation and diagnostics. Pending status is derived
from the native ready-row query and is not a separate bridge field. Full decrypted envelopes and all
other envelope fields never cross the diagnostic bridge; full envelopes remain available only to the
authenticated sync path. Polls are serialized, stale results are ignored, and preview state is
cleared on screen blur, app backgrounding, and unmount. While the viewer is focused, Android
`FLAG_SECURE` blocks screenshots and recent-task previews; cleanup removes the flag. No preview or
enumerated app-list data is logged or persisted by the viewer. Decryption never creates a missing
tenant key, and queue reads are serialized against tenant cleanup. See
[ADR-0009](../decisions/0009-local-android-capture-diagnostics.md).

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
[build lifecycle hooks](https://docs.expo.dev/build-reference/npm-hooks/). SMS implementation follows
Android's [`Telephony.Sms` provider contract](https://developer.android.com/reference/android/provider/Telephony.Sms),
[`SMS_RECEIVED_ACTION` contract](https://developer.android.com/reference/android/provider/Telephony.Sms.Intents#SMS_RECEIVED_ACTION),
and [runtime permission workflow](https://developer.android.com/training/permissions/requesting).
