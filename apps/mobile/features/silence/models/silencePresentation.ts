/**
 * What the quiet screen says, decided away from the components that render it.
 *
 * Every string here is about a capability a person cannot take back, so the wording is part of the
 * behaviour rather than decoration. Three distinctions are load-bearing and kept visible in the copy:
 *
 * - **Clearing is not silencing.** Android tells a listener about a notification only after it has
 *   posted and alerted, so Relay removes a notification that has already made its sound. The screen
 *   says that plainly and points at the one control that can stop the sound -- Android's own per-app
 *   notification settings -- rather than implying Relay can.
 * - **Clearing is not hiding.** Hiding removes a row from Relay's own inbox and never touches the
 *   phone. Clearing changes what is on the phone. Neither borrows the other's verbs.
 * - **Snoozing is not dismissing.** Android brings a snoozed notification back; nothing brings back
 *   a cancelled one. The copy never lets the reversible one stand in for the irreversible one.
 */

import type { NotificationSilenceDecision, NotificationSilenceOutcome } from "@relay/contracts";

import { refusalExplanation, type SilenceRuleStatus } from "@/lib/notification-silence";
import type { StatusPillTone } from "@/components/ui";

export type SilenceStage = SilenceRuleStatus["stage"];

export type SilenceRuleRow = {
  /**
   * The primary control this row offers, or none when the rule needs editing instead.
   *
   * `authorize` is available without a dry run behind it (ADR-0021). `observe` is the second
   * control on the same row rather than a precondition for the first.
   */
  action: "authorize" | "observe" | "review" | "withdraw" | undefined;
  /** True when the row should also offer to start watching, alongside its primary control. */
  offersObservation: boolean;
  detail: string;
  filterRuleId: string;
  name: string;
  pill: { label: string; tone: StatusPillTone };
  /** Null once the window has elapsed; the number of whole hours left otherwise. */
  remainingHours: number | undefined;
  stage: SilenceStage;
};

const DECISION_LABELS: Record<NotificationSilenceDecision, string> = {
  // Not a verdict yet. Your phone cannot ask a model from inside the notification listener, so it
  // waits for the next pass -- see ADR-0019.
  "awaiting-model": "Waiting on your model",
  declined: "Matched, not acted on",
  dismissed: "Cleared for good",
  // The honest end of a deferred decision: the rule matched, and by the time the answer came back
  // there was nothing left on screen.
  "no-longer-posted": "Already gone by then",
  "no-match": "Did not match",
  snoozed: "Put away for two hours",
  "would-dismiss": "Would have been cleared for good",
  "would-snooze": "Would have been put away",
};

const DECISION_TONES: Record<NotificationSilenceDecision, StatusPillTone> = {
  "awaiting-model": "accent",
  declined: "warning",
  // Cancelling is the one verdict a person cannot undo, so it does not share a tone with snoozing.
  dismissed: "warning",
  // Nothing happened and nothing went wrong, which is what muted means here.
  "no-longer-posted": "muted",
  "no-match": "muted",
  snoozed: "success",
  "would-dismiss": "accent",
  "would-snooze": "accent",
};

export function decisionLabel(decision: NotificationSilenceDecision): string {
  return DECISION_LABELS[decision];
}

export function decisionTone(decision: NotificationSilenceDecision): StatusPillTone {
  return DECISION_TONES[decision];
}

/**
 * One rule's row.
 *
 * `remainingHours` is the gate a person is waiting on, so it is stated as a number rather than as
 * "soon". The review control appears only once it reaches zero, because the database refuses the
 * transition before then and offering a button that cannot work is worse than offering none.
 *
 * `modelConfigured` is the fourth distinction the copy carries. A rule that asks a model acts on the
 * next pass rather than as the notification arrives, and if no model is configured it never acts at
 * all. Both have to be said: a reader who authorized such a rule and was told it clears
 * notifications "once they arrive" has been promised something that will not happen.
 */
/** Whether a rule still needs a model's answer before it decides anything. */
function awaitsModelFor(status: SilenceRuleStatus): boolean {
  return status.compiled?.awaitsModel ?? false;
}

export function silenceRuleRow(
  status: SilenceRuleStatus,
  options: { killSwitchEngaged: boolean; modelConfigured: boolean; remainingHours: number },
): SilenceRuleRow {
  const base = {
    filterRuleId: status.rule.id,
    name: status.rule.name,
    stage: status.stage,
  };

  if (status.stage === "refused") {
    return {
      ...base,
      action: undefined,
      offersObservation: false,
      detail:
        status.refusal === undefined
          ? "This rule cannot be used to clear notifications."
          : refusalExplanation(status.refusal),
      pill: { label: "Cannot clear", tone: "muted" },
      remainingHours: undefined,
    };
  }

  if (status.stage === "unauthorized") {
    return {
      ...base,
      // Authorizing directly is the primary control now. Watching first is offered beside it for a
      // reader who wants to see the rule decide before letting it act.
      action: status.rule.enabled ? "authorize" : undefined,
      detail: status.rule.enabled
        ? "Let this rule act now, or watch what it would do first."
        : "This rule is switched off, so it cannot act on anything.",
      offersObservation: status.rule.enabled,
      pill: { label: "Not acting", tone: "muted" },
      remainingHours: undefined,
    };
  }

  if (status.stage === "observing") {
    const elapsed = status.rule.dryRunCompletedAt !== undefined || options.remainingHours === 0;
    return {
      ...base,
      // Available throughout, not only once the window elapses. A reader who has seen enough does
      // not have to wait out a clock to act on what they already know.
      action: "authorize",
      detail:
        awaitsModelFor(status) && !options.modelConfigured
          ? "Watching, but this rule asks a model and no model is set up on this phone, so it will record nothing. Add one on the Your data screen."
          : elapsed
            ? "The watching period is over. Read what it decided below, then let it act."
            : `Watching. Nothing is being changed on your phone yet — read what it has decided below, and let it act whenever you are satisfied. ${options.remainingHours} ${options.remainingHours === 1 ? "hour" : "hours"} of watching left.`,
      offersObservation: false,
      pill: elapsed
        ? { label: "Ready to review", tone: "accent" }
        : { label: "Watching", tone: "muted" },
      remainingHours: elapsed ? 0 : options.remainingHours,
    };
  }

  // The two acting states never share wording. A person who authorized a snooze and reads a
  // sentence about clearing for good has been told their notifications are gone when they are not,
  // and the reverse is worse.
  const awaitsModel = awaitsModelFor(status);
  // A rule with no literal tests reaches every notification Relay captures. That is what the reader
  // asked for, and it is also the single most important thing to say on the row: the difference
  // between "cleared in one app" and "cleared everywhere" is not something to leave them to infer.
  const unscoped = status.compiled?.unscoped ?? false;
  const reach = unscoped ? "Every notification Relay captures is checked. " : "";
  // A rule that asks a model acts on the next pass, not as the notification arrives. Saying "once
  // they arrive" would promise a speed this cannot deliver -- see ADR-0019.
  const when = awaitsModel
    ? "a few minutes after they arrive, once your phone has asked your model"
    : "once they arrive";
  const effect =
    status.rule.action === "dismiss"
      ? `cleared for good ${when}. Nothing brings them back.`
      : `put away for two hours ${when}, then Android brings them back.`;
  const acting = `${reach}Notifications this rule matches are ${effect} They stay in Relay, and your phone still makes its sound first.`;

  // A rule that asks a model and has no model will never decide anything. Saying it is clearing
  // notifications would be the screen's own false statement, not the rule's.
  const unanswerable =
    "This rule asks a model, and no model is set up on this phone. Nothing will be cleared until you add one on the Your data screen.";

  return {
    ...base,
    action: "withdraw",
    offersObservation: false,
    detail: options.killSwitchEngaged
      ? "Allowed to clear notifications, but everything is stopped right now."
      : awaitsModel && !options.modelConfigured
        ? unanswerable
        : acting,
    pill: options.killSwitchEngaged
      ? { label: "Stopped", tone: "warning" }
      : awaitsModel && !options.modelConfigured
        ? { label: "Waiting on a model", tone: "warning" }
        : {
            label: status.rule.action === "dismiss" ? "Clearing" : "Putting away",
            tone: "success",
          },
    remainingHours: undefined,
  };
}

export type SilenceReviewSummary = {
  matched: number;
  missed: number;
  observed: number;
};

/**
 * What the ledger says about one rule, which is the evidence the enable transition is recorded with.
 *
 * `observed` counts every notification from an application the rules name, matched or not. A window
 * in which a rule matched nothing is as informative as one in which it matched everything, and
 * counting only matches would hide the rule that quietly never fired.
 */
export function reviewSummary(
  outcomes: readonly NotificationSilenceOutcome[],
  filterRuleId: string,
): SilenceReviewSummary {
  const matched = outcomes.filter((outcome) => outcome.filterRuleId === filterRuleId).length;
  return { matched, missed: outcomes.length - matched, observed: outcomes.length };
}

/**
 * What Relay can and cannot do, said plainly and without a hedge.
 *
 * This is the most important string in the feature. Android hands a notification to a listener only
 * after it has posted and alerted, and the hook that runs earlier is reserved for system apps, so
 * Relay cannot stop a sound and no amount of permission granting will change that. A screen that
 * implied otherwise would be selling the one thing this cannot deliver.
 *
 * What it can do is clear the notification afterwards, and tell a person exactly where the switch
 * that *does* stop the sound lives -- in Android's own per-app settings, changed by them.
 */
export function capabilityNotice(capabilities: { notificationListener: boolean }): {
  detail: string;
  tone: "info" | "warning";
} {
  if (!capabilities.notificationListener) {
    return {
      detail:
        "Relay needs notification access before it can watch anything. Grant it on the Sources screen.",
      tone: "warning",
    };
  }
  return {
    detail:
      "Android tells Relay about a notification only after your phone has already made its sound, so a rule here puts a notification away rather than stopping the noise. To stop an app making noise at all, use its own notification settings — Relay links to them for every app your rules name.",
    tone: "info",
  };
}

/** The apps a person could silence in Android, from the rules they have written. */
export function namedApplications(statuses: readonly SilenceRuleStatus[]): string[] {
  const named = new Set<string>();
  for (const status of statuses) {
    for (const clause of status.compiled?.clauses ?? []) {
      for (const test of clause.tests) {
        if (test.field !== "source.applicationId") continue;
        if (test.operator !== "equals" && test.operator !== "in") continue;
        for (const value of test.values) named.add(value);
      }
    }
  }
  return [...named].sort((left, right) => left.localeCompare(right));
}
