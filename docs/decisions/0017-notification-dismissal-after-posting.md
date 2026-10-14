---
status: accepted
date: 2026-10-05
owners: maintainers
---

# ADR-0017: Notification Dismissal After Posting

## Context

The product promise is a quieter phone, and the gates for acting on a source notification were
already written. [#38](https://github.com/redsteadz/relay/issues/38) requires an explicit application
predicate, no semantic clause, a completed dry-run period, a reviewed match/miss history, an explicit
enable transition, an audit record, and kill switches. (The semantic restriction was lifted by
[ADR-0019](0019-device-semantic-evaluation.md); every other gate here stands unchanged.) `filter_rules.dismiss_source_notification` and
`filter_rules.dismissal_dry_run_completed_at` have existed since the initial schema. Nothing read
either column, and `RelayNotificationListenerService` had no cancellation capability at all.

Building the mechanism surfaced two facts that change what can be built, one about the platform and
one about the schema.

`NotificationListenerService.onNotificationPosted` is delivered **after** the system has ranked,
posted, and alerted. By the time Relay can see a notification, the phone has already made its sound
and vibrated. The listener's whole mutation surface is `cancelNotification`, `snoozeNotification`,
`cancelAllNotifications`, `setNotificationsShown`, and `requestInterruptionFilter` — remove it, hide
it for a while, remove everything, mark it seen, or change device-wide Do Not Disturb. Nothing in
that list is per-notification and pre-alert.

The hook that runs before a notification is posted is `NotificationAssistantService.onNotificationEnqueued`,
which can return an `Adjustment` carrying `KEY_IMPORTANCE` to demote a notification to
`IMPORTANCE_LOW` and post it silently. **It is not available to Relay.** Both
`NotificationAssistantService` and `Adjustment` are `@SystemApi`: absent from the public `android.jar`
an app build compiles against, and reachable only by a privileged system app. Verified against
`/opt/android-sdk/platforms/android-36/android.jar`, whose `android/service/notification/` package
contains `NotificationListenerService`, `StatusBarNotification`, `ConditionProviderService`,
`ZenPolicy` and `Condition` — and neither of the two classes a pre-posting adjustment needs. An
earlier revision of this ADR assumed otherwise and specified an assistant service; it did not
compile, which is how the constraint was found.

So: **a sideloaded Relay cannot stop a notification ringing, and no permission the user can grant
will change that.** The remaining options were to ship the post-hoc capability and say so, or to
ship nothing.

The second fact is that **the two gate columns could never have been written.** A filter revision is
immutable: `filter_rules_enforce_immutability` refuses every `UPDATE` to the table except a narrow
safety-disable of `enabled` for `service_role`. A column on that row can be set once at insert and
never again — and a dry run that completes three days later, or an authorization a person withdraws,
is exactly a later write. The columns were unreachable by construction, which is the likeliest reason
nothing ever read them. This was also found by running the code: the first pgTAP assertion against
the routines came back `55000: Filter revisions are immutable`.

## Decision

Relay acts on a notification after Android has posted and alerted it, through the listener, and the
product says exactly that.

A rule authorized to act may do one of two things:

| Action    | Call                          | Effect                                               | Reversible |
| --------- | ----------------------------- | ---------------------------------------------------- | ---------- |
| `snooze`  | `snoozeNotification(key, 2h)` | Removed from the shade; Android brings it back later | Yes        |
| `dismiss` | `cancelNotification(key)`     | Cancelled; nothing brings it back                    | No         |

`snooze` is the default a newly reviewed rule gets, because a rule a person has just finished
watching is the one most likely to still be wrong, and a two-hour delay is a recoverable mistake
where a cancellation is not. The first matching rule decides, in the snapshot's own order, whatever
its action — one verdict per notification, mirroring how one rule claims a capture.

**Where Relay cannot act, it hands over the control that can.** The quiet screen lists the
applications the person's own rules name and opens each one's Android notification settings
(`ACTION_APP_NOTIFICATION_SETTINGS`), where they can silence the app or a single channel themselves.
That is the only thing on the device that stops the sound, so rather than leaving it as a caveat it
is a control on the screen.

Which of the two a rule does is chosen when its dry run starts, and the screen offers them as two
separate controls rather than one with a default, because the choice between reversible and not is
the whole decision. Changing it restarts the window: what a person watched a snoozing rule do is not
evidence about the same rule cancelling.

**Authorization lives beside the revision, not on it.** `notification_dismissal_authorizations` is
keyed by `(user_id, filter_rule_id)` and holds the action, the window, the evidence, and
`authorized_at`. This is the same shape and the same reasoning as `hidden_inbox_events` beside
`relay_events`: one row is a machine-owned immutable record, the other is a person's decision that
changes over time, and forcing the second into the first loses one of them. Keying it to a revision
rather than a series makes withdrawal on edit automatic — a new revision simply has no authorization
row — so the "an edit costs another window" behaviour is structural rather than remembered.

**Authorization is the database's; the device holds a cache.** A rule may act only when
`authorized_at` is set, and the only writers are `start_notification_dismissal_dry_run_v1`,
`complete_notification_dismissal_dry_run_v1`, and `set_notification_dismissal_v1`. They validate the
deterministic plan and an explicit `source.applicationId` predicate that every satisfying assignment
of the expression passes through; they measure the dry-run
window on the server clock between two calls, so a device cannot report a window it never ran; and
each writes `audit_log` in the same statement as the change. Two check constraints carry the gate in
the schema as well: nothing may be authorized without a completed window, and a window cannot
complete before it started. The app writes the resulting snapshot natively with a monotonic
revision, so a sync that loses a race cannot reinstate withdrawn authorization.

**What the device may evaluate is narrower than what a rule may say.** The decision is made in a
system-bound process with the app dead, holding a `StatusBarNotification` and nothing else, so
`compileNotificationSilenceRule` flattens a plan into a bounded disjunction of literal tests over the
three fields reliably present at that moment: `source.applicationId`, `source.kind`, and `subject`.
Everything else is refused with a reason the UI states:

- **Negation.** A negated predicate over a field Android did not supply is true by absence, so it
  would clear a notification the rule never described. Device classification guards the same hazard
  by declaring field availability up front ([ADR-0014](0014-device-local-classification.md)); the
  listener has no way to do that.
- **`sender` and `body`.** Present only sometimes — `sender` only when an app used `MessagingStyle`.
  A predicate whose field may silently be absent is a predicate that stops narrowing.
- **`category` and `attributes.*`.** Derived after the capture, so they do not exist when the
  decision is made. A category is also a classification, and a classification can never authorize
  this.
- **Anything exceeding the compiled bounds** — 16 clauses, 16 tests per clause. A conjunction of
  disjunctions multiplies, so a plan the contract accepts can still expand past what is carried in a
  SharedPreferences snapshot and looped over per notification. Refusing is the safe direction;
  truncating a disjunction matches strictly more than the rule asked for.

Text comparison mirrors `evaluateFilterPlan` exactly — NFKC, collapse the JavaScript `\s` class,
trim, lowercase `en-US`. Kotlin and TypeScript each implement it and both suites assert the same
vectors, because a comparison that drifts between the runtime that compiles a rule and the one that
acts on it would clear the wrong notification.

**The dry run is device-local evidence; the enable transition is the database's.** A would-act
decision can only be observed where notifications arrive, so the device records it content-free:
application id, rule id, capture identity, verdict, time. No title, no text, no sender; never
uploaded; bounded to 1000 rows and thirty days. It is keyed by the capture identity the same function
derives for the capture itself, which is what makes an outcome reviewable against an item a person
recognises rather than an abstract log line.

The verdict is recorded **before** the notification is touched. Afterwards the row is the only
remaining evidence that Relay did anything, so a crash between the two must leave a record of an act
that did not happen rather than an act with no record.

Scope is the capture allowlist intersected with the applications a rule names. A notification no rule
names is never evaluated and never recorded, so the ledger cannot become a log of every app a person
uses.

### What this does not relax

Category, AI result, and confidence **alone** can never authorize acting on a notification. The
compiler refuses a `category` predicate outright, so the device cannot express the rule that would
violate this even if asked to. The deterministic part of a plan is required in the database routine
and again in the compiler, so a rule that is only a model's judgement is refused at both ends.

A semantic clause alongside that deterministic part no longer disqualifies a plan;
[ADR-0019](0019-device-semantic-evaluation.md) lifted that and records why. The substance of this
section is unchanged: a model answers one question inside a scope a person wrote, named an
application in, observed, and reviewed. It never selects the application, the action, or whether the
rule may act.

## Schema conflict resolved in the same change

The two unreachable columns are dropped rather than left in place. A column that cannot be written is
a standing invitation to write code against it, and the next person to try would rediscover the
immutability trigger the way this change did. Nothing has ever read or written either, so there is no
data to preserve.

The table-level `filter_rules_check` goes with them, and with it a conflict worth naming. It required
`approval_mode = 'automatic'` before `dismiss_source_notification` could be true. That contradicts
[the action model](../architecture/action-model.md), which states that "notification dismissal is
separate from provider action approval", and it was actively unsafe rather than merely redundant:
`action_rules` reference filter rules, so opting into a quieter phone would have silently converted
that rule's provider actions from requiring approval to running automatically. A reader asking for
one notification to stop interrupting them would have authorized an irreversible external effect.
The replacement gates carry no opinion about `approval_mode`, and the pgTAP suite asserts that a rule
authorized to act still has `approval_mode = 'required'`. Both sources are updated in this change
rather than reconciled quietly.

## Consequences

- **Relay does not stop sounds, and the UI must never imply it does.** The capability notice says the
  phone has already made its sound, and the screen offers the per-app Android settings that can. This
  is the one string in the feature most worth protecting; `silencePresentation.test.ts` asserts both
  halves of it.
- A notification is cleared a moment after it arrives, which is visible: the shade flickers. That is
  the honest shape of the capability rather than a defect to hide.
- `snooze` returns the notification later, so a reader who authorized a rule and left will see
  matching notifications reappear in batches. The copy states the two-hour window rather than letting
  "put away" read as "gone".
- The capability needs no new permission and no device-wide setting change. Notification-listener
  access, which capture already requires, is the whole requirement — which also means no new
  distribution constraint and nothing extra for a later Play-safe profile to omit.
- Revoking listener access unbinds the service and stops everything immediately.
- A rule can be authorized server-side and still refused by the compiler. That asymmetry is shown
  with its reason, because a rule that appears to work and quietly does nothing is worse than one
  that says it cannot.
- Editing a rule writes a new revision, which holds no authorization, so an edit costs another
  observation window. The evidence a person reviewed was evidence about the rule as it was written
  then.
- Withdrawing authorization keeps the completed window, so restoring it does not cost another three
  days. Restarting the window discards the evidence, because that is the case where the evidence no
  longer describes what the rule will do.
- If Relay is ever distributed as a privileged system app, `NotificationAssistantService` becomes
  available and pre-posting silencing becomes possible. That would be a new ADR superseding this
  decision's mechanism, not a change to its gates — the dry run, the explicit application predicate,
  the audit record and the kill switches would all still apply.
- On-device behaviour is not covered by automated tests. The pure policy, the snapshot parser, the
  compiler, the normalization vectors and the database gates are — the last verified against a local
  Supabase, which is also how the immutability constraint was found. The listener's actual effect on a
  real shade needs manual verification on hardware.

## References

- [Android notifications and SMS](../integrations/android.md)
- [Action and approval model](../architecture/action-model.md)
- [Privacy and data lifecycle](../security/privacy.md)
- [ADR-0014: Device-local classification](0014-device-local-classification.md)
- [ADR-0003: Deterministic filters before BYOK AI](0003-deterministic-before-ai.md)
- [`NotificationListenerService`](https://developer.android.com/reference/android/service/notification/NotificationListenerService)
- [`NotificationListenerService.snoozeNotification`](<https://developer.android.com/reference/android/service/notification/NotificationListenerService#snoozeNotification(java.lang.String,%20long)>)
- [`Settings.ACTION_APP_NOTIFICATION_SETTINGS`](https://developer.android.com/reference/android/provider/Settings#ACTION_APP_NOTIFICATION_SETTINGS)
