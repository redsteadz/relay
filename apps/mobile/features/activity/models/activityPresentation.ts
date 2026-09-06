/**
 * The activity timeline.
 *
 * Two independent records share one ordered view: the action approval ledger, which says what Relay
 * proposed to do on the user's behalf and what was decided, and the AI disclosure history, which
 * says what left the device and why. They are stored separately and read separately, so merging
 * them is a presentation concern and lives here rather than in either read path.
 *
 * Nothing in this module invents an entry. A timeline with no rows is an empty array, and the screen
 * says so; the previous version of that screen rendered three fixed examples, including a semantic
 * disclosure that never happened, which stated something false about Relay's own privacy behaviour.
 */

import {
  actionRunStatusSchema,
  type ActionRunStatus,
  type PrivacyDisclosure,
} from "@relay/contracts";

/** One ledger row, as read from `action_runs`. */
export type ActionRunInput = {
  actionRuleId: string;
  approvedAt: string | null;
  attemptCount: number;
  completedAt: string | null;
  createdAt: string;
  errorCode: string | null;
  eventId: string;
  id: string;
  provider: string;
  status: string;
};

/** The owning rule, which is where provider, operation, and approval mode actually live. */
export type ActionRuleInput = {
  approvalMode: string;
  id: string;
  operation: string;
};

/** Enough of a derived event to name what an action was about. `relay_events.title` is not null. */
export type ActivityEventInput = {
  id: string;
  title: string;
};

export type ActionActivityEntry = {
  /** Present only once a decision was recorded, so a pending run cannot look resolved. */
  decidedAt: string | undefined;
  detail: string;
  icon: string;
  id: string;
  kind: "action";
  occurredAt: string;
  /** Set when the run carries a failure the user can act on. */
  problem: string | undefined;
  status: ActionRunStatus;
  statusLabel: string;
  title: string;
};

export type DisclosureActivityEntry = {
  fields: readonly string[];
  icon: string;
  id: string;
  kind: "disclosure";
  model: string;
  occurredAt: string;
  provider: string;
  title: string;
};

/** One `audit_log` row, with the bounded metadata keys a timeline names it by. */
export type AuditEntryInput = {
  action: string;
  createdAt: string;
  id: string;
  provider: string | null;
  purgedCount: string | null;
  version: string | null;
};

/**
 * A record from the audit trail: a rule saved, a retention sweep, a connection removed.
 *
 * Distinct from an action entry because nothing here was ever proposed to the user or decided by
 * them. These already happened, and the timeline says so rather than offering a decision.
 */
export type AuditActivityEntry = {
  detail: string;
  icon: string;
  id: string;
  kind: "retention" | "rule" | "source";
  occurredAt: string;
  title: string;
};

export type ActivityEntry = ActionActivityEntry | AuditActivityEntry | DisclosureActivityEntry;

/** The kinds a reader can narrow the timeline to. `all` is not a kind, it is the absence of one. */
export type ActivityFilter = "action" | "all" | "disclosure" | "retention" | "rule" | "source";

export const activityFilters: readonly { key: ActivityFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "action", label: "Actions" },
  { key: "disclosure", label: "Disclosures" },
  { key: "rule", label: "Rules" },
  { key: "retention", label: "Retention" },
  { key: "source", label: "Sources" },
];

/**
 * How each audit action reads on the timeline.
 *
 * Closed rather than derived from the slug, because these lines are the ledger's own prose and a
 * mechanically un-hyphenated action name would be a worse sentence than a written one. An action
 * absent from this table is dropped by `auditEntry` rather than guessed at.
 */
const AUDIT_DESCRIPTIONS: Readonly<
  Record<string, { icon: string; kind: AuditActivityEntry["kind"]; title: string }>
> = {
  "connector.disconnected": {
    icon: "link-variant-off",
    kind: "source",
    title: "Connection removed",
  },
  "connector.revoked": { icon: "link-variant-off", kind: "source", title: "Connection revoked" },
  "filter.revision_compiled": { icon: "tune-variant", kind: "rule", title: "Rule saved" },
  "privacy.account_deletion_finalized": {
    icon: "delete-outline",
    kind: "retention",
    title: "Account deletion completed",
  },
  "privacy.account_deletion_requested": {
    icon: "delete-clock-outline",
    kind: "retention",
    title: "Account deletion requested",
  },
  "privacy.raw_payloads_purged": {
    icon: "timer-sand-complete",
    kind: "retention",
    title: "Raw copies deleted",
  },
};

/**
 * Describes one audit row, or nothing when this build has no name for its action.
 *
 * The detail is assembled only from metadata keys the routine is known to write. A key that is
 * absent is left out of the sentence rather than rendered as an empty value, so a row never claims
 * a count or a version it does not carry.
 */
export function auditEntry(row: AuditEntryInput): AuditActivityEntry | undefined {
  const described = AUDIT_DESCRIPTIONS[row.action];
  if (described === undefined) return undefined;

  const parts: string[] = [];
  if (row.version !== null && row.version !== "") parts.push(`v${row.version}`);
  if (row.provider !== null && row.provider !== "") parts.push(actionProviderLabel(row.provider));
  if (row.purgedCount !== null && row.purgedCount !== "") {
    parts.push(
      row.purgedCount === "1" ? "1 payload deleted" : `${row.purgedCount} payloads deleted`,
    );
  }

  return {
    detail: parts.length === 0 ? "Recorded by Relay" : parts.join(" · "),
    icon: described.icon,
    id: `audit-${row.id}`,
    kind: described.kind,
    occurredAt: row.createdAt,
    title: described.title,
  };
}

/** Narrows the timeline to one kind. `all` returns it unchanged rather than filtering to nothing. */
export function filterActivity(
  entries: readonly ActivityEntry[],
  filter: ActivityFilter,
): readonly ActivityEntry[] {
  return filter === "all" ? entries : entries.filter((entry) => entry.kind === filter);
}

const statusLabels: Readonly<Record<ActionRunStatus, string>> = {
  approved: "Approved",
  "awaiting-approval": "Awaiting your approval",
  cancelled: "Cancelled",
  failed: "Failed",
  proposed: "Proposed",
  running: "Running",
  succeeded: "Completed",
};

const providerLabels: Readonly<Record<string, string>> = {
  "google-tasks": "Google Tasks",
  "nextcloud-budget": "Nextcloud Budget",
  webhook: "Webhook",
};

/**
 * A provider Relay does not recognize is named as-is rather than hidden.
 *
 * A row whose provider this build has never heard of still happened, and dropping it would make the
 * timeline quietly incomplete — the opposite of what this screen is for.
 */
export function actionProviderLabel(provider: string): string {
  return providerLabels[provider] ?? provider;
}

export function actionStatusLabel(status: ActionRunStatus): string {
  return statusLabels[status];
}

/** Statuses where nothing has been decided yet, so the row is still the user's to answer. */
export function isAwaitingDecision(status: ActionRunStatus): boolean {
  return status === "proposed" || status === "awaiting-approval";
}

function statusIcon(status: ActionRunStatus): string {
  if (status === "failed") return "alert-circle-outline";
  if (status === "cancelled") return "close-circle-outline";
  if (status === "succeeded") return "check-circle-outline";
  if (status === "running") return "progress-clock";
  return "gesture-tap-button";
}

/**
 * Describes a failure without repeating provider prose.
 *
 * `action_runs.error_message` can carry text a provider returned, which is outside Relay's control
 * and is not shown. The stable `error_code` is, because it is Relay's own vocabulary and is what a
 * person would quote when asking why something did not happen.
 */
function actionProblem(run: ActionRunInput, status: ActionRunStatus): string | undefined {
  if (status !== "failed") return undefined;
  const attempts =
    run.attemptCount === 1 ? "after 1 attempt" : `after ${run.attemptCount.toString()} attempts`;
  return run.errorCode === null ? `Failed ${attempts}.` : `Failed ${attempts} (${run.errorCode}).`;
}

/**
 * Builds one ledger entry, or nothing when the row cannot be trusted.
 *
 * A status this build does not know is dropped rather than guessed at: rendering an unrecognized
 * state under a familiar label would tell the user a decision was made that may not have been. The
 * row stays in the database and reappears once the app understands it.
 */
function actionEntry(
  run: ActionRunInput,
  rules: ReadonlyMap<string, ActionRuleInput>,
  events: ReadonlyMap<string, ActivityEventInput>,
): ActionActivityEntry | undefined {
  const parsedStatus = actionRunStatusSchema.safeParse(run.status);
  if (!parsedStatus.success) return undefined;
  const status: ActionRunStatus = parsedStatus.data;

  const rule = rules.get(run.actionRuleId);
  const event = events.get(run.eventId);
  const subject = event?.title;
  // Both lookups are defensive rather than expected: `action_runs` holds a restricting foreign key
  // to its rule and a cascading one to its event, so neither can be absent while the run exists.
  // They are still handled, because a row this screen cannot name is worth showing incompletely
  // rather than dropping from a timeline whose purpose is completeness.
  const operation = rule === undefined ? "Action" : rule.operation;
  const provider = actionProviderLabel(run.provider);

  const decidedAt = run.completedAt ?? run.approvedAt ?? undefined;
  const automatic = rule?.approvalMode === "automatic";

  return {
    decidedAt,
    detail:
      subject === undefined
        ? `${provider} · ${operation}`
        : `${provider} · ${operation} · ${subject}`,
    icon: statusIcon(status),
    id: run.id,
    kind: "action",
    occurredAt: run.createdAt,
    problem: actionProblem(run, status),
    status,
    statusLabel:
      automatic && isAwaitingDecision(status)
        ? `${actionStatusLabel(status)} · automatic rule`
        : actionStatusLabel(status),
    title: subject ?? operation,
  };
}

/**
 * Turns a stored purpose slug into something a person reads.
 *
 * `purpose` is Relay's own vocabulary (`semantic-clause-evaluation`), not source content, so
 * reshaping it is presentation rather than interpretation. An unrecognized purpose still renders,
 * because a disclosure that happened must appear whether or not this build has a name for it.
 */
export function disclosurePurposeLabel(purpose: string): string {
  const spaced = purpose.replaceAll("-", " ").replaceAll("_", " ").trim();
  if (spaced === "") return purpose;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function disclosureEntry(disclosure: PrivacyDisclosure): DisclosureActivityEntry {
  return {
    fields: disclosure.disclosedFields,
    icon: "brain",
    id: disclosure.id,
    kind: "disclosure",
    model: disclosure.model,
    occurredAt: disclosure.createdAt,
    provider: disclosure.provider,
    title: disclosurePurposeLabel(disclosure.purpose),
  };
}

/**
 * Merges both records into one timeline, newest first.
 *
 * Ties break on id so the order is total and a re-render cannot reshuffle two rows written in the
 * same millisecond. An unparseable timestamp sorts last rather than throwing, because one bad row
 * must not take the whole screen down.
 */
export function activityTimeline(input: {
  audit?: readonly AuditEntryInput[];
  disclosures: readonly PrivacyDisclosure[];
  events: readonly ActivityEventInput[];
  rules: readonly ActionRuleInput[];
  runs: readonly ActionRunInput[];
}): ActivityEntry[] {
  const ruleIndex = new Map(input.rules.map((rule) => [rule.id, rule]));
  const eventIndex = new Map(input.events.map((event) => [event.id, event]));

  const entries: ActivityEntry[] = [];
  for (const run of input.runs) {
    const entry = actionEntry(run, ruleIndex, eventIndex);
    if (entry !== undefined) entries.push(entry);
  }
  for (const disclosure of input.disclosures) entries.push(disclosureEntry(disclosure));
  for (const row of input.audit ?? []) {
    const entry = auditEntry(row);
    if (entry !== undefined) entries.push(entry);
  }

  return entries.sort((left, right) => {
    const leftTime = Date.parse(left.occurredAt);
    const rightTime = Date.parse(right.occurredAt);
    const leftValid = !Number.isNaN(leftTime);
    const rightValid = !Number.isNaN(rightTime);
    if (!leftValid || !rightValid) {
      if (leftValid) return -1;
      if (rightValid) return 1;
      return left.id < right.id ? -1 : 1;
    }
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.id < right.id ? -1 : 1;
  });
}

/**
 * How many entries still need the user.
 *
 * Counted from the ledger only. A disclosure is a record of something that already happened and can
 * never be pending, so including it would inflate a number the user reads as a to-do list.
 */
export function pendingDecisionCount(entries: readonly ActivityEntry[]): number {
  return entries.filter((entry) => entry.kind === "action" && isAwaitingDecision(entry.status))
    .length;
}

export type ActivityDay = { day: string; entries: readonly ActivityEntry[] };

/**
 * Groups an ordered timeline into days.
 *
 * Today and yesterday are named rather than dated, because that is how a person refers to them and
 * a date beside "12:41" adds nothing they did not already know. Anything older keeps its date. The
 * input is assumed already sorted, so grouping preserves order rather than re-deriving it.
 */
export function groupActivityByDay(
  entries: readonly ActivityEntry[],
  now: Date = new Date(),
): readonly ActivityDay[] {
  const days: ActivityDay[] = [];
  for (const entry of entries) {
    const day = activityDayLabel(entry.occurredAt, now);
    const current = days[days.length - 1];
    if (current !== undefined && current.day === day) {
      (current.entries as ActivityEntry[]).push(entry);
    } else {
      days.push({ day, entries: [entry] });
    }
  }
  return days;
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function activityDayLabel(iso: string, now: Date): string {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "Undated";
  if (sameDay(value, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(value, yesterday)) return "Yesterday";
  return value.toDateString();
}

/** A fixed message: a read failure must not surface a database error to the user. */
export function activityErrorMessage(): string {
  return "Relay could not load your activity. Check your connection and retry.";
}
