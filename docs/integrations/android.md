---
status: accepted
owner: mobile
last_verified: 2026-09-06
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
failed state when Relay refuses the payload itself. It is bounded to 500 items and 2 MiB per
tenant. A device item is deleted only when `/api/ingest` returns `202` with a validated
`{ accepted: true, durable: true, id }` acknowledgement for the same envelope. Sign-out and device
revocation delete the Keystore key before deleting tenant rows, so an interrupted clear cannot leave
decryptable source data.

Only `400` and `413` retire a capture, along with a stored envelope this build cannot read. Every
other answer — an expired token, a device not yet active, a rate limit, an outage, a `404` from an
origin that is not Relay — describes the environment rather than the capture, so the capture stays
queued until it is delivered or expires. Counting those toward a retry budget discarded captures for
conditions certain to resolve on their own; seven-day expiry is the only bound on how long an
undeliverable capture is held.

An upload pass stops at the first such answer instead of continuing through the queue, so an outage
costs one attempt rather than one per queued capture. Uploading is not gated on a source being
active: those captures were taken under the consent that applied when they were taken, and it is
pausing that stops new reads while deleting queued captures is its own explicit action.

`READ_SMS` and `RECEIVE_SMS` are sensitive Google Play permissions. Google documents possible
exceptions for device automation and SMS-based money management, subject to review. MVP therefore
uses sideload distribution and prominent consent. Non-SMS builds remain an architectural
requirement for later Play distribution.

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
