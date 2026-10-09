---
status: accepted
date: 2026-10-09
owners: maintainers
---

# ADR-0021: A Quiet Rule Can Be Authorized Directly

## Context

[#38](https://github.com/redsteadz/relay/issues/38) required a completed, server-clocked 72-hour dry
run before a rule could act on a notification, and
[ADR-0017](0017-notification-dismissal-after-posting.md) put that gate in three places: the routine,
a table check constraint, and the UI. Changing a rule's action restarted the window, on the grounds
that watching a snoozing rule is not evidence about the same rule cancelling.

The maintainer's objection, which is correct: **the notification is still in Relay.**

`onNotificationPosted` enqueues the capture and retains its content _before_ calling
`actIfAuthorized` — deliberately, with a comment saying why. So anything a rule clears has already
been stored, is in the inbox, and stays in device-local retention for thirty days. "Irreversible"
only ever described the row in the shade, not the information. A three-day wait to protect
information that is not at risk is a gate whose cost is certain and whose benefit was overstated.

Two related overstatements, recorded so they are not repeated: the dry run was also described as
bounding what reaches a model, which [ADR-0020](0020-unscoped-quiet-rules.md) already showed the
filing path does not do either; and the restart-on-action-change rule treated the action as if it
affected what a rule matches, which it does not.

## Decision

A rule can be authorized immediately, with no dry run behind it, and its action can be changed in
place without losing the authorization or the evidence.

- `set_notification_dismissal_v1` upserts and takes an optional action. A reader who never watched
  the rule has no row, and the authorization is the row's reason for existing.
- Omitting the action keeps what is stored. Turning a rule off and on again must not quietly turn a
  snooze into a cancellation.
- An unnamed action on a first authorization defaults to `snooze`, so the irreversible one is always
  something the reader asked for by name.
- `notification_dismissal_needs_completed_dry_run` is dropped. `dry_run_completed_at` is now null
  for a rule authorized directly, and that null is what distinguishes "enabled after review" from
  "enabled straight away" in an audit read.
- The dry run stays, unchanged, as a thing a reader may choose. The screen offers it beside the
  enable rather than in front of it, and the enable stays live throughout a window that is running.

### What still stands

The capture allowlist, the kill switch, the per-application pause, revoking listener access, the
device-local verdict ledger, and the record in `audit_log` on every transition. The reversible
action remains the default and the irreversible one remains a separate, differently-worded,
destructive-toned control.

### One limit added, not a gate

Relay will not act on an **ongoing** notification — `FLAG_ONGOING_EVENT`: a call in progress, a
navigation session, a download, a media player. This is the one place the maintainer's reasoning
does not reach. Relay stores a notification's text, not its actions or its session, so the inbox
copy of a call notification cannot answer the call and the copy of a navigation notification cannot
resume it. Those are not recoverable from Relay, which is exactly the property that made the
three-day window unnecessary everywhere else.

It costs a reader nothing they asked for: an ongoing notification is not the kind of thing a quiet
rule is written about. If it turns out to be unwanted, it is one condition in
`NotificationSilencePolicy`, not a workflow.

## Consequences

- A reader can write a rule and have it acting in two taps. This is the intended experience for an
  app whose premise is that the person knows what they want.
- A rule can be enabled on no evidence at all, including a semantic rule whose judgement the reader
  has never seen. That is the trade, it is theirs to make, and the verdict ledger is still there to
  read afterwards — along with the kill switch, which takes one tap.
- `dry_run_completed_at` becomes a meaningful null rather than always-set. Anything reading it as a
  proxy for "authorized" would now be wrong; nothing does.
- #38's acceptance criteria are contradicted for the second time, after ADR-0020. The issue text and
  the code disagree about the window as well as the application predicate until both are struck.

## Supersedes

Amends [ADR-0017](0017-notification-dismissal-after-posting.md): the completed dry run is no longer
a precondition for a rule acting, and changing an action no longer restarts a window. The
post-posting limitation that is that ADR's main subject is untouched.

Does not supersede [ADR-0020](0020-unscoped-quiet-rules.md); it continues the same correction.

## References

- [Android notifications and SMS](../integrations/android.md)
- [Action and approval model](../architecture/action-model.md)
