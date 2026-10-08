/**
 * Turning what the database authorized into what the device may act on.
 *
 * Two questions have to answer yes before a notification is cleared, and they are separate. The
 * database decides *whether* a rule may act: `set_notification_dismissal_v1` validates the
 * deterministic plan, the absence of a semantic clause, the explicit application predicate, and the
 * completed dry-run window, and it is the only writer of `notification_dismissal_authorizations`.
 * `compileNotificationSilenceRule` decides whether the device can evaluate the rule *faithfully*,
 * refusing anything that is not reliably available at decision time rather than approximating it.
 *
 * A rule can therefore be authorized server-side and still be refused here. That asymmetry is
 * surfaced with its reason rather than hidden, because a rule that looks like it is working and
 * quietly does nothing is worse than one that says it cannot.
 *
 * See [ADR-0017](../../../docs/decisions/0017-notification-dismissal-after-posting.md).
 */

import {
  filterPlanSchema,
  notificationSilenceSnapshotSchema,
  type NotificationSilenceAction,
  type NotificationSilenceMode,
  type NotificationSilenceRule,
  type NotificationSilenceSnapshot,
} from "@relay/contracts";
import { compileNotificationSilenceRule, type SilenceRefusal } from "@relay/domain";

/** One `filter_rules` revision, with whatever authorization it holds. */
export type SilenceAuthorization = {
  /** What this rule does when it matches. `snooze` until someone chooses otherwise. */
  action: NotificationSilenceAction;
  /** Whether `authorized_at` is set: the database's answer, and the only thing that permits acting. */
  authorized: boolean;
  dryRunCompletedAt: string | undefined;
  dryRunStartedAt: string | undefined;
  enabled: boolean;
  id: string;
  name: string;
  plan: unknown;
  seriesId: string;
  version: number;
};

/** Where one rule stands, for a screen to state plainly instead of leaving a gap. */
export type SilenceRuleStatus = {
  /** Set when the device cannot evaluate this rule, whatever the database said. */
  refusal?: SilenceRefusal;
  rule: SilenceAuthorization;
  /** The compiled form, present whenever the device could evaluate it. */
  compiled?: NotificationSilenceRule;
  stage: "acting" | "observing" | "unauthorized" | "refused";
};

export type SilencePlan = {
  snapshot: NotificationSilenceSnapshot;
  statuses: SilenceRuleStatus[];
};

/**
 * The newest revision of each series, which is the only one that can be authorized.
 *
 * An authorization is keyed to a revision id, so editing a rule withdraws it by construction: the
 * new revision simply has no authorization row. That is the intended behaviour rather than an
 * inconvenience -- the evidence a person reviewed was evidence about the rule as it was written
 * then.
 */
function newestRevisions(rules: readonly SilenceAuthorization[]): SilenceAuthorization[] {
  const newest = new Map<string, SilenceAuthorization>();
  for (const rule of rules) {
    const current = newest.get(rule.seriesId);
    if (current === undefined || rule.version > current.version) newest.set(rule.seriesId, rule);
  }
  return [...newest.values()].sort((left, right) =>
    left.name === right.name
      ? left.seriesId.localeCompare(right.seriesId)
      : left.name.localeCompare(right.name),
  );
}

/**
 * Compiles every rule that is either authorized or under observation.
 *
 * A rule whose dry run has not started is not in the snapshot at all. Observing a rule the person
 * has not asked to observe would record decisions about their notifications that nothing asked for.
 */
export function compileSilencePlan(
  rules: readonly SilenceAuthorization[],
  options: {
    disabledPackages?: readonly string[];
    killSwitchEngaged: boolean;
    revision: number;
  },
): SilencePlan {
  const statuses: SilenceRuleStatus[] = [];
  const compiled: NotificationSilenceRule[] = [];

  for (const rule of newestRevisions(rules)) {
    const observing = !rule.authorized;

    // Whether the device can evaluate a rule is a property of the rule, so it is decided before
    // anything else. Deciding it after the "nobody is watching this yet" branch meant a rule that
    // can never be authorized -- one naming no application, say -- was reported as merely not
    // started, which rendered a live "start watching" control. The database then refused the write
    // on plan shape, and the reason, which this function had already been able to name, was thrown
    // away in favour of a generic failure.
    const plan = filterPlanSchema.safeParse(rule.plan);
    if (!plan.success) {
      statuses.push({ refusal: "no-deterministic-clause", rule, stage: "refused" });
      continue;
    }

    const result = compileNotificationSilenceRule(plan.data, {
      action: rule.action,
      filterRuleId: rule.id,
      observing,
    });
    if (result.status === "refused") {
      statuses.push({ refusal: result.refusal, rule, stage: "refused" });
      continue;
    }

    // Only now does being switched off or unobserved matter. Such a rule keeps its compiled form --
    // the apps it names are still worth offering Android's own per-app settings for -- but it is not
    // in the snapshot, so the device cannot act on it.
    if (!rule.enabled || (observing && rule.dryRunStartedAt === undefined)) {
      statuses.push({ compiled: result.rule, rule, stage: "unauthorized" });
      continue;
    }

    compiled.push(result.rule);
    statuses.push({ compiled: result.rule, rule, stage: observing ? "observing" : "acting" });
  }

  return {
    snapshot: notificationSilenceSnapshotSchema.parse({
      disabledPackages: [...(options.disabledPackages ?? [])],
      killSwitchEngaged: options.killSwitchEngaged,
      mode: snapshotMode(compiled),
      revision: options.revision,
      rules: compiled,
    }),
    statuses,
  };
}

/**
 * The snapshot's overall state.
 *
 * `off` is the only value the listener treats as an instruction, so it must mean exactly "there is
 * nothing to do": no compiled rule, including none under observation.
 */
function snapshotMode(rules: readonly NotificationSilenceRule[]): NotificationSilenceMode {
  if (rules.length === 0) return "off";
  return rules.every((rule) => rule.observing) ? "dry-run" : "enforcing";
}

/** Whether any rule reached the end of its window and is waiting on a person to review it. */
export function reviewableRules(statuses: readonly SilenceRuleStatus[]): SilenceRuleStatus[] {
  return statuses.filter(
    (status) => status.stage === "observing" && status.rule.dryRunCompletedAt !== undefined,
  );
}

/** How much of the observation window is left, in whole hours, or zero once it has elapsed. */
export function remainingWindowHours(
  startedAt: string | undefined,
  minimumHours: number,
  now: number,
): number {
  if (startedAt === undefined) return minimumHours;
  const elapsedHours = (now - Date.parse(startedAt)) / 3_600_000;
  if (!Number.isFinite(elapsedHours)) return minimumHours;
  return Math.max(0, Math.ceil(minimumHours - elapsedHours));
}

/**
 * Why the device will not evaluate a rule, in words a person can act on.
 *
 * Each one names the part of the rule to change, except `too-complex`, which is about how far the
 * rule expands rather than anything visible in how it was written.
 */
export function refusalExplanation(refusal: SilenceRefusal): string {
  switch (refusal) {
    case "awaits-model":
      return "This rule asks a model to decide, and only a rule your phone can decide by itself may clear a notification.";
    case "matches-nothing":
      return "This rule cannot match anything, so there is nothing for it to clear.";
    case "negation-unsupported":
      return "This rule says what a notification must not be. Your phone cannot tell an absent field from one it could not read, so it would clear more than you asked.";
    case "no-deterministic-clause":
      return "This rule has no conditions your phone can check.";
    case "too-complex":
      return "This rule has too many combinations to check as each notification arrives. Splitting it into separate rules will work.";
    case "unbounded-application":
      return "This rule does not name an app exactly. Clearing a notification needs an app named with “is”, not described.";
    case "unreadable-field":
      return "This rule reads something that does not exist yet when the decision is made — a category, a message body, or a sender. Only the app and the title are reliably there.";
  }
}
