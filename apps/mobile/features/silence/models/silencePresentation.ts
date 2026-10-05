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
  /** The one control this row offers, or none when the rule needs editing instead. */
  action: "authorize" | "observe" | "review" | "withdraw" | undefined;
  detail: string;
  filterRuleId: string;
  name: string;
  pill: { label: string; tone: StatusPillTone };
  /** Null once the window has elapsed; the number of whole hours left otherwise. */
  remainingHours: number | undefined;
  stage: SilenceStage;
};

const DECISION_LABELS: Record<NotificationSilenceDecision, string> = {
  declined: "Matched, not acted on",
  dismissed: "Cleared for good",
  "no-match": "Did not match",
  snoozed: "Put away for two hours",
  "would-dismiss": "Would have been cleared for good",
  "would-snooze": "Would have been put away",
};

const DECISION_TONES: Record<NotificationSilenceDecision, StatusPillTone> = {
  declined: "warning",
  // Cancelling is the one verdict a person cannot undo, so it does not share a tone with snoozing.
  dismissed: "warning",
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
 */
export function silenceRuleRow(
  status: SilenceRuleStatus,
  options: { killSwitchEngaged: boolean; remainingHours: number },
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
      action: status.rule.enabled ? "observe" : undefined,
      detail: status.rule.enabled
        ? "Watch what this rule would do for three days before it is allowed to do it."
        : "This rule is switched off, so it is not watching anything.",
      pill: { label: "Not watching", tone: "muted" },
      remainingHours: undefined,
    };
  }

  if (status.stage === "observing") {
    const elapsed = status.rule.dryRunCompletedAt !== undefined || options.remainingHours === 0;
    return {
      ...base,
      action: elapsed ? "review" : undefined,
      detail: elapsed
        ? `The watching period is over. Review what it decided, then choose whether it may ${
            status.rule.action === "dismiss"
              ? "clear a notification for good"
              : "put a notification away"
          }.`
        : `Watching. Nothing is being changed on your phone. ${options.remainingHours} ${options.remainingHours === 1 ? "hour" : "hours"} left.`,
      pill: elapsed
        ? { label: "Ready to review", tone: "accent" }
        : { label: "Watching", tone: "muted" },
      remainingHours: elapsed ? 0 : options.remainingHours,
    };
  }

  // The two acting states never share wording. A person who authorized a snooze and reads a
  // sentence about clearing for good has been told their notifications are gone when they are not,
  // and the reverse is worse.
  const acting =
    status.rule.action === "dismiss"
      ? "Notifications this rule matches are cleared for good once they arrive. Nothing brings them back. They stay in Relay, and your phone still makes its sound first."
      : "Notifications this rule matches are put away for two hours once they arrive, then Android brings them back. They stay in Relay, and your phone still makes its sound first.";

  return {
    ...base,
    action: "withdraw",
    detail: options.killSwitchEngaged
      ? "Allowed to clear notifications, but everything is stopped right now."
      : acting,
    pill: options.killSwitchEngaged
      ? { label: "Stopped", tone: "warning" }
      : { label: status.rule.action === "dismiss" ? "Clearing" : "Putting away", tone: "success" },
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
