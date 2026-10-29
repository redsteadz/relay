/**
 * What the quiet controls say, decided away from the components that render them.
 *
 * The controls live on the rule since ADR-0023: a stage in the rule editor chooses what a rule does
 * to a matching notification, the Rules tab shows each rule's standing as a pill and carries the
 * stop. There is no separate quiet screen any more, and nothing here should assume one.
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

import type {
  NotificationSilenceAction,
  NotificationSilenceDecision,
  NotificationSilenceOutcome,
  NotificationSilenceRule,
} from "@relay/contracts";
import type { SilenceCompilation } from "@relay/domain";

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

/**
 * A rule that asks a model and has no model will never decide anything. Saying it is clearing
 * notifications would be the screen's own false statement, not the rule's.
 */
const UNANSWERABLE =
  "This rule asks a model, and no model is set up on this phone. Nothing will be cleared until you add one on the Your data screen.";

/**
 * What an acting rule does, as one sentence.
 *
 * The two acting states never share wording. A person who authorized a snooze and reads a sentence
 * about clearing for good has been told their notifications are gone when they are not, and the
 * reverse is worse.
 */
export function actingSentence(
  action: NotificationSilenceAction,
  flags: { awaitsModel: boolean; unscoped: boolean },
): string {
  // A rule with no literal tests reaches every notification Relay captures. That is what the reader
  // asked for, and it is also the single most important thing to say: the difference between
  // "cleared in one app" and "cleared everywhere" is not something to leave them to infer.
  const reach = flags.unscoped ? "Every notification Relay captures is checked. " : "";
  // A rule that asks a model acts on the next pass, not as the notification arrives. Saying "once
  // they arrive" would promise a speed this cannot deliver -- see ADR-0019.
  const when = flags.awaitsModel
    ? "a few minutes after they arrive, once your phone has asked your model"
    : "once they arrive";
  const effect =
    action === "dismiss"
      ? `cleared for good ${when}. Nothing brings them back.`
      : `put away for two hours ${when}, then Android brings them back.`;
  return `${reach}Notifications this rule matches are ${effect} They stay in Relay, and your phone still makes its sound first.`;
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

  const awaitsModel = awaitsModelFor(status);
  const acting = actingSentence(status.rule.action, {
    awaitsModel,
    unscoped: status.compiled?.unscoped ?? false,
  });

  return {
    ...base,
    action: "withdraw",
    offersObservation: false,
    detail: options.killSwitchEngaged
      ? "Allowed to clear notifications, but everything is stopped right now."
      : awaitsModel && !options.modelConfigured
        ? UNANSWERABLE
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

/** The apps one compiled rule names outright, which are the ones Android can silence for it. */
export function applicationsNamedBy(rule: NotificationSilenceRule | undefined): string[] {
  const named = new Set<string>();
  for (const clause of rule?.clauses ?? []) {
    for (const test of clause.tests) {
      if (test.field !== "source.applicationId") continue;
      if (test.operator !== "equals" && test.operator !== "in") continue;
      for (const value of test.values) named.add(value);
    }
  }
  return [...named].sort((left, right) => left.localeCompare(right));
}

/** The apps a person could silence in Android, from the rules they have written. */
export function namedApplications(statuses: readonly SilenceRuleStatus[]): string[] {
  const named = new Set<string>();
  for (const status of statuses) {
    for (const application of applicationsNamedBy(status.compiled)) named.add(application);
  }
  return [...named].sort((left, right) => left.localeCompare(right));
}

/**
 * What a rule does to a matching notification, as the reader chooses it on the rule.
 *
 * Four values rather than the three the database stores, because "watch first" is a state a reader
 * chooses as deliberately as the other two: it records verdicts and changes nothing, and it is how a
 * reader who is not yet sure what their rule matches finds out without a notification paying for it.
 */
export type QuietChoice = "dismiss" | "none" | "observe" | "snooze";

export const QUIET_CHOICES: readonly { detail: string; label: string; value: QuietChoice }[] = [
  {
    detail: "Matching notifications stay on your phone. The rule only files the capture.",
    label: "Leave it",
    value: "none",
  },
  {
    detail:
      "Records what this rule would do to each matching notification without changing any, so you can read its verdicts before letting it act.",
    label: "Watch first",
    value: "observe",
  },
  {
    detail:
      "Removes a matching notification from the shade. Android brings it back two hours later.",
    label: "Put away for two hours",
    value: "snooze",
  },
  {
    detail: "Cancels a matching notification. Nothing brings it back.",
    label: "Clear for good",
    value: "dismiss",
  },
];

export function quietChoiceLabel(choice: QuietChoice): string {
  return QUIET_CHOICES.find((entry) => entry.value === choice)?.label ?? "Leave it";
}

/** The choice a stored rule currently expresses, read from where the database says it stands. */
export function quietChoiceFor(status: SilenceRuleStatus | undefined): QuietChoice {
  if (status === undefined) return "none";
  if (status.stage === "acting") return status.rule.action;
  if (status.stage === "observing") return "observe";
  return "none";
}

export type QuietStageState = {
  /**
   * Why no choice but "leave it" is available, when that is so. A rule the device cannot evaluate,
   * or one that is paused, cannot act whatever a reader picks, and offering the picks anyway would
   * have the database refuse a save the editor could have explained.
   */
  blocked: string | undefined;
  /** What the current choice will mean once saved, in the words the row will later use. */
  detail: string;
  /** True when the choice asks a model and this phone has none, so nothing will ever be decided. */
  needsModel: boolean;
};

/**
 * The quiet stage of the rule editor, decided from the draft's own compilation.
 *
 * The compilation is the preview one -- the same `compileNotificationSilenceRule` the device plan
 * runs -- so what the stage promises is what the saved rule will be able to do. A plan that refuses
 * here will refuse on the device too, and the reader learns it before saving rather than from a row
 * that says "cannot clear" afterwards.
 */
export function quietStageState(options: {
  choice: QuietChoice;
  compilation: SilenceCompilation | undefined;
  enabled: boolean;
  killSwitchEngaged: boolean;
  modelConfigured: boolean;
}): QuietStageState {
  const { compilation } = options;
  if (compilation === undefined) {
    return {
      blocked:
        "Describe what the rule matches first. What it can do to a notification follows from how that compiles.",
      detail: "",
      needsModel: false,
    };
  }
  if (compilation.status === "refused") {
    return { blocked: refusalExplanation(compilation.refusal), detail: "", needsModel: false };
  }
  if (!options.enabled) {
    return {
      blocked: "A paused rule cannot act on a notification. Enable it to choose.",
      detail: "",
      needsModel: false,
    };
  }

  const { awaitsModel, unscoped } = compilation.rule;
  const needsModel = awaitsModel && !options.modelConfigured && options.choice !== "none";
  const stopped = options.killSwitchEngaged
    ? " Everything is stopped right now from the Rules screen; this takes effect when you release the stop."
    : "";

  switch (options.choice) {
    case "none":
      return {
        blocked: undefined,
        detail: "Matching notifications stay on your phone. The rule only files the capture.",
        needsModel: false,
      };
    case "observe":
      return {
        blocked: undefined,
        detail: needsModel
          ? "Watching needs a model too: this rule asks one, and none is set up on this phone, so it would record nothing."
          : `${unscoped ? "Every notification Relay captures is checked. " : ""}Relay records what it would do to each matching notification and changes none. Read the verdicts below, then let it act.${stopped}`,
        needsModel,
      };
    case "snooze":
    case "dismiss":
      return {
        blocked: undefined,
        detail: needsModel
          ? UNANSWERABLE
          : `${actingSentence(options.choice, { awaitsModel, unscoped })}${stopped}`,
        needsModel,
      };
  }
}

/**
 * The pill a rule's row carries, or none when the rule does nothing to notifications.
 *
 * Reuses the row model so the Rules tab and the editor never disagree about what a rule is doing.
 * A rule that is merely not acting shows nothing: most rules only file, and a pill saying so on
 * every row would be noise on the one screen whose job is to be scannable.
 */
export function quietPill(
  status: SilenceRuleStatus | undefined,
  options: { killSwitchEngaged: boolean; modelConfigured: boolean },
): { label: string; tone: StatusPillTone } | undefined {
  if (status === undefined || status.stage === "unauthorized") return undefined;
  if (status.stage === "refused") return undefined;
  // The window no longer gates anything (ADR-0021), so a row does not count it down; a watched rule
  // is simply watching until the reader decides.
  if (status.stage === "observing") return { label: "Watching", tone: "muted" };
  return silenceRuleRow(status, { ...options, remainingHours: 0 }).pill;
}
