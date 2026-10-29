---
status: accepted
date: 2026-10-23
owners: maintainers
---

# ADR-0023: Quiet Is Chosen On The Rule, And The Device Model Path Reports What It Did

## Context

[ADR-0017](0017-notification-dismissal-after-posting.md) put the quiet controls on a screen of their
own under Settings: a list of every rule, each with its own sequence of gates -- watch, review,
allow -- and the stop at the top. [ADR-0021](0021-direct-quiet-authorization.md) removed the gates,
which removed the reason for the sequence, and left the screen as a second list of the same rules
with one control per row. A reader writing a rule had to finish it, leave, find Quiet, find the rule
again and authorize it there. A reader looking at a rule in Rules could not see whether it quieted
anything.

Separately, [ADR-0019](0019-device-semantic-evaluation.md) and
[ADR-0022](0022-decision-engine-endpoints.md) made the device ask a model, and made every failure an
outcome rather than an error: unreachable, refused, wrong shape, not configured, all `undecided`, the
capture left waiting, the notification left alone. Correct, and invisible. The refusals were written
to a device-local disclosure table that no screen read. The pass that should have asked could stop
at four gates before any request -- the notification listener unbound so the shade could not be
read, no model configured, no local store, every candidate already swiped away -- and each was a
bare `return 0`. A reader saw "waiting on your model" and had no way to learn that the Jev preset
pointed at a marketing site, or that their dev client reinstall had left the listener unbound.

## Decision

### Quiet is a stage of the rule editor

The rule editor gains a stage, "What it does to the notification", with four choices: leave it,
watch first, put away for two hours, clear for good. The choices are decided from the draft's own
compilation through `compileNotificationSilenceRule`, the same function the device plan runs, so a
rule the device would refuse is explained before it is saved rather than as a row saying "cannot
clear" afterwards. The stage shows the rule's verdicts, each with the notification's title, and the
Android settings link for each app the rule names.

Saving applies the choice to the revision that was saved. A revision is appended only when the rule
itself changed; a reader who changes only the choice keeps their version, because authorization is
keyed to the revision and a new one would withdraw it for nothing. Re-stating the same choice is not
re-applied, because restarting a watch discards the verdicts being read.

The Rules tab shows each rule's standing as a pill on its row, and carries the stop at the top of the
list whenever any rule can act. The stop is a halt, not an act; the structural boundary test still
holds that nothing under `app/(tabs)/`, `features/inbox/` or `components/` can reach the cancel or
snooze capability. The quiet screen and its Settings entry are removed.

### Every pass over pending model work says where it stopped

A device-local journal, bounded to the last twelve passes per tenant and content-free, records each
quiet pass, filing pass and manual probe: when it ran, what triggered it, why it stopped, how many
candidates it found and skipped and why, and for every model request the host, the model, the
protocol, the duration, the HTTP status and the refusal. `evaluateDeviceSemanticClause` now reports
duration, protocol and status on every outcome. The two silent `continue`s in the quiet resolver --
retained content expired, rule since edited -- are counted and named.

The native capabilities report whether the listener is bound, distinct from whether access is
granted, and how many candidates are pending regardless of whether they are still posted. Those two
facts are what let a pass that found nothing to ask distinguish "nothing is waiting" from "something
is waiting and the shade cannot be read".

A page under Your data, "Model on this phone", shows the live listener state, a button that asks the
configured model one synthetic question and reports what came back, a button that runs the quiet
pass now, the journal, and the device's own disclosure rows. The rule editor links to it from any
verdict that is waiting, with the last pass's explanation inline.

### The Jev preset names the API host

Jev is served at `https://api.typesafe.ai/v1`, requires a bearer key, and answers `/v1/systemone`
with `answers.<key>.noul` and no confidence field for a yes/no question. The preset pointed at
`thejevai.com`, which is the product site. It now points at the API host and says a key is needed.

## Consequences

- One fewer screen, and the choice is made where the rule is written. The order watch-then-act is
  still available; it is no longer a route.
- A verdict that says "waiting" can be traced in two taps to the reason: the listener, the model, the
  address, the key, the retained text, or a rule edited since. The structured logs are unchanged;
  this is the same allowlist shown to the person who owns the phone.
- The journal and the diagnostics page hold no notification text, no question, no key and no full
  URL. The probe sends a synthetic message and nothing a reader received.
- The native capability fields are optional in the TypeScript type, so a JavaScript bundle running
  against an older native build reads them as unknown and the diagnostics say so, rather than
  claiming the listener is off.

## Supersedes

Amends [ADR-0017](0017-notification-dismissal-after-posting.md): the quiet controls are no longer a
screen. Its decisions about what the listener may evaluate, the ledger, the three stops and the
boundary test are unchanged.

## References

- [Android notifications and SMS](../integrations/android.md)
- [Error handling and observability](../memory/observability.md)
- [TypeSafe Jev API, as documented by Zuplo](https://zuplo.com/docs/ai-gateway/jev.md)
