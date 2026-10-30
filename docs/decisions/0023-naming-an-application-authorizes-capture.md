---
status: accepted
date: 2026-10-30
owners: maintainers
---

# ADR-0023: Naming An Application In A Rule Authorizes Its Capture

## Context

The mobile app has always required a separate, prior step before a rule could do anything with an
application's notifications: open Sources, open "Manage apps"
(`apps/mobile/app/sources/notifications/apps.tsx`), and tick it on. [ADR-0020](0020-unscoped-quiet-rules.md)
described this as a gate that "still decides which applications are seen at all," independent of
any rule's own predicate, and treated it as settled.

**That was never the intended product.** The separate app-selection step was friction, not a
deliberate second consent ritual — the premise of a rule-driven app is that writing the rule is
the decision. ADR-0020's framing is corrected here, not debated: if naming an application in a
rule doesn't already authorize Relay to see that application's notifications, the rule system
isn't doing what it was supposed to.

### Why this is safe, not just convenient

The allowlist's actual job — never reading a notification's content for an application the person
hasn't identified — does not depend on how that identification happens. In
`RelayNotificationListenerService.onNotificationPosted`
(`apps/mobile/modules/relay-device-ingress/android/src/main/java/com/redsteadz/relaydeviceingress/RelayNotificationListenerService.kt:78-101`),
`capturable()` (line 82) is checked, and returns on failure, **before** `EXTRA_TITLE`, `EXTRA_TEXT`,
or the structured sender are read at all — that happens only in `NotificationEnvelopeFactory.create`
(`NotificationEnvelopeFactory.kt:108-136`), reachable only once `capturable()` has passed.
`capturable()` delegates to `NotificationCapturePolicy.decide`
(`NotificationCapturePolicy.kt:27-44`), whose only inputs are `postingPackage`, `relayPackage`,
notification flags, and `allowedPackages` — never content. The same gate, at the same line, covers
the backlog sweep (`captureAlreadyPosted`, line 281).

So the property worth protecting is: **content is never read until the person has explicitly named
the application.** A rule naming an application is exactly that: a compiled `FilterPlan`'s
deterministic predicate carries a `source.applicationId` test
(`packages/contracts/src/index.ts:825`), and `namedApplications()`
(`apps/mobile/features/silence/models/silencePresentation.ts:253-265`) already walks a compiled
rule's clauses to extract exactly these values for display. Writing and saving such a rule names
the application no less explicitly than ticking it in a list — it's the same fact, captured earlier.

## Decision

When a rule is saved (`saveFilterRule`, `apps/mobile/features/filters/api/filters.ts:110`) or
authorized (`setRuleDismissal`, `apps/mobile/features/silence/api/silence.ts:244-255`, which calls
`set_notification_dismissal_v1`) and its compiled plan names one or more applications via a
`source.applicationId` test, those application ids are added to `notificationAllowedPackages` as
part of that same action, through `RelayDeviceIngress.configureNotificationCapture`. Writing and
saving or authorizing the rule **is** the authorization. No separate trip to Sources is required
first.

- The manual picker in `apps/sources/notifications/apps.tsx` is not removed. It remains the direct
  way to let Relay capture an application's notifications before or without writing any rule about
  it (reading an inbox with no rule yet), and the place to review or revoke what capture currently
  includes.
- Unscoped and semantic-only rules ([ADR-0020](0020-unscoped-quiet-rules.md)) are unchanged: with
  no literal `source.applicationId`, there is nothing to imply, and they keep operating only over
  whatever is already allowlisted, exactly as before.
- Onboarding no longer has to route a person through a standalone app-selection screen before they
  can write their first rule. (This is what unblocks the onboarding redesign already underway.)

## Consequences

- The content-blind property of the gate is unchanged: `capturable()` still runs before any content
  is read, in the same file, same line. Only the set of writers that can populate the allowlist
  grows from one (the picker) to two (the picker, or an application named in a saved/authorized
  rule).
- A person who writes a rule naming an application they didn't mean to grant now has to notice and
  revoke it from Sources, rather than never having granted it. Stated plainly because it is a real
  behavior change: naming an application in a rule is now a capture-granting act, not only a
  filter-authoring one.
- The comment at `packages/contracts/src/index.ts:1759-1760` ("a notification from an application
  the reader never allowed Relay to capture is never evaluated") remains literally true — "allowed"
  now has two sources, and the comment should be read that way. No contract or schema shape changes;
  `notificationAllowedPackages` already accepts entries from `configureNotificationCapture`
  regardless of caller.
- `docs/architecture/filter-model.md` and `docs/integrations/android.md` describe the allowlist as a
  prior, separately-curated step and need a pass to reflect this ADR; tracked as follow-up, not done
  in this change.

## Supersedes

Amends [ADR-0020](0020-unscoped-quiet-rules.md): the capture allowlist remains one of "the gates
that remain," but is no longer framed as curated independently of a rule's own content — naming an
application in a rule is now one of the ways the allowlist is populated, alongside the manual
picker.

Does not supersede [ADR-0021](0021-direct-quiet-authorization.md) or
[ADR-0019](0019-device-semantic-evaluation.md): dry-run, ordering, and the deterministic-before-AI
sequence are unaffected.

## References

- [Filter model](../architecture/filter-model.md)
- [Android notifications and SMS](../integrations/android.md)
- [Privacy and data lifecycle](../security/privacy.md)
