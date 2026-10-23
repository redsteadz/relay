---
status: accepted
owner: architecture
last_verified: 2026-10-23
---

# ADR-0024: Capture-safe logout and delivery recovery

## Decision

Keep the existing [clear-on-logout policy](../security/privacy.md). Logout first checks every
unexpired unsynchronized capture, including failed deliveries, under the native capture lock. A
nonempty queue requires Sync Now, Cancel, or explicit Discard & Sign Out. Sync Now can explicitly
reopen unexpired failed captures; automatic runs cannot reset their retry budget. The final check and clear
are atomic relative to capture. Successful logout clears local stores and credentials before the
session; it never deletes server records or disconnects server-side Gmail.

Foreground preparation, delivery and logout serialize in the JavaScript runtime. Headless delivery
prepares its restored tenant without permission to clean another account's native configuration.
Native generation and tenant checks remain mandatory. Account transitions clear query caches and
remount navigation, remove old derived/model data, and reset background-delivery consent.

Inbox reconciliation uses source identity rather than event ID. Server events, including hidden
ones, suppress corresponding local events. An incomplete server list can be supplemented only by
local captures still in the unexpired unsynchronized queue; acknowledged local copies do not
resurrect server-hidden/deleted records. An unavailable server retains the existing offline read.

Amend [ADR-0018](0018-background-capture-delivery.md): SMS synchronization and notification sweeps
request the existing Expo worker after durable enqueue. Immediate work appends instead of using
KEEP, preventing arrivals after a running snapshot from being dropped. Expedite only on Android 12+
without delay; Expo's worker has no pre-12 foreground-info implementation. Native queue schema v5
adds durable retry eligibility without modifying encrypted envelopes. Failed/background passes
schedule a delayed network-constrained follow-up; the independent periodic chain remains fallback.

Classification errors retain the source but return a retryable processing response before completed
dedup markers are committed. A same-ID database duplicate without a completed marker can finish
classification and planning. Transient undecided semantic failures also remain retryable rather than
being mistaken for an unmatched result. Nonretryable classification errors use an internal 422
response and go directly to encrypted dead-letter recovery; they do not repeatedly invoke an
unauthorized or misconfigured dependency. Cross-ID duplicates without corresponding facts cannot. Existing
encrypted Queue backoff, dead-letter storage and replay own recovery. Existing action IDs, outbox,
provider idempotency and authorization gates continue to protect effects. Supabase remains durable
system of record. An uncertain classification write may be evaluated again on recovery; exactly-once
semantic requests are not claimed. Unrelated maintenance failures cannot suppress an outbox attempt.

## Consequences and verification

No permanent service, parallel uploader, production migration, or mobile Google credential is added.
Native module signatures and SQLite schema change, so Android verification requires an approved
fresh native build; a browser preview cannot verify them. User force-stop, Doze, quotas and OEM
restrictions still constrain delivery. See the [verification and device checklist](../operations/session-background-verification.md).

Platform references: [Android work requests](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work),
[Expo background tasks](https://docs.expo.dev/versions/latest/sdk/background-task/),
[Gmail push](https://developers.google.com/workspace/gmail/api/guides/push).
