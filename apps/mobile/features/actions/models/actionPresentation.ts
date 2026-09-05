import { actionRunStatusSchema, type ActionDecision, type ActionRunStatus } from "@relay/contracts";
import { canDecideActionRun } from "@relay/domain";

import { actionProviderLabel } from "@/features/activity/models/activityPresentation";

/**
 * The proposal half of a receipt.
 *
 * A capture is only half a record until Relay says what it would do about it, and this is that half:
 * one provider, one rendered action, one time, and the decision still outstanding. It is derived
 * from `action_runs` and its owning rule, never from source content.
 *
 * Approval and cancellation availability is not decided here. `canDecideActionRun` mirrors the
 * transition table in `decide_action_run`, which holds a row lock and remains the authority; this
 * model only asks it, so a control is never offered for a decision the database would refuse.
 */

/** One `action_runs` row, with the two input keys a proposal is named by. */
export type ActionRunInput = {
  actionRuleId: string;
  createdAt: string;
  /** `input->>due`. Provider-specific and frequently absent, so never required. */
  due: string | null;
  eventId: string;
  id: string;
  provider: string;
  status: string;
  /** `input->>title`. The rendered action, read by one key rather than the whole blob. */
  title: string | null;
};

/** The owning rule, which is where the operation actually lives. */
export type ActionRuleInput = { id: string; operation: string };

export type ProposedAction = {
  /** True while the tenant may still approve. Drives whether Approve is offered at all. */
  canApprove: boolean;
  /** When Relay proposed it, for the receipt's provenance trail. */
  createdAt: string;
  /** True while the tenant may still call it off. Outlives `canApprove` by one status. */
  canSkip: boolean;
  /** When the action would fall due, when its provider records one. */
  due: string | undefined;
  eventId: string;
  id: string;
  /** Display name of the provider that would receive it. */
  provider: string;
  status: ActionRunStatus;
  /** What Relay would create, falling back to the operation when the provider names nothing. */
  title: string;
};

/**
 * Turns a stored operation slug into something a person reads.
 *
 * The slug is Relay's own vocabulary rather than source content, so reshaping it is presentation.
 * An unrecognized operation still renders: an action Relay is proposing must be nameable even when
 * this build has never seen its verb.
 */
export function actionOperationLabel(operation: string): string {
  const spaced = operation.replaceAll("-", " ").replaceAll("_", " ").trim();
  if (spaced === "") return operation;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Builds one proposal, or nothing when the row cannot be trusted.
 *
 * A status this build does not know is dropped rather than guessed at. Offering Approve beside a
 * state Relay cannot classify would invite a decision on something it cannot describe, which is the
 * one thing an approval control must never do.
 */
export function proposedAction(
  run: ActionRunInput,
  rules: ReadonlyMap<string, ActionRuleInput>,
): ProposedAction | undefined {
  const parsed = actionRunStatusSchema.safeParse(run.status);
  if (!parsed.success) return undefined;
  const status = parsed.data;
  const operation = rules.get(run.actionRuleId)?.operation;
  const rendered = run.title === null || run.title === "" ? undefined : run.title;
  return {
    canApprove: canDecideActionRun(status, "approve"),
    createdAt: run.createdAt,
    canSkip: canDecideActionRun(status, "cancel"),
    due: run.due === null || run.due === "" ? undefined : run.due,
    eventId: run.eventId,
    id: run.id,
    provider: actionProviderLabel(run.provider),
    status,
    title:
      rendered ?? (operation === undefined ? "Proposed action" : actionOperationLabel(operation)),
  };
}

/**
 * Indexes proposals by the event they belong to.
 *
 * A rule and an event pair to exactly one run by construction -- the identity is a UUIDv5 over the
 * pair -- but two different rules may both propose from one event. The newest wins the receipt's
 * one proposal slot in a list, and the rest stay visible on the detail screen rather than being
 * dropped: an action a person cannot see is an action they cannot cancel.
 */
export function proposalsByEvent(
  proposals: readonly ProposedAction[],
): ReadonlyMap<string, readonly ProposedAction[]> {
  const grouped = new Map<string, ProposedAction[]>();
  for (const proposal of proposals) {
    const existing = grouped.get(proposal.eventId);
    if (existing === undefined) grouped.set(proposal.eventId, [proposal]);
    else existing.push(proposal);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  return grouped;
}

/** Fixed, deterministic confirmation for a decision that reached the ledger. */
export function actionDecisionMessage(decision: ActionDecision, provider: string): string {
  return decision === "approve" ? `Sent to ${provider}` : "Skipped · nothing sent";
}

/**
 * What a reader is told when a decision could not be recorded.
 *
 * Deliberately says the proposal is unchanged. A failed approval that reads as a generic error
 * leaves a person unsure whether the action went out anyway, which is the worst thing an approval
 * screen can be ambiguous about.
 */
export function actionDecisionErrorMessage(decision: ActionDecision): string {
  return decision === "approve"
    ? "Could not record your approval. Nothing was sent, and the proposal is still waiting."
    : "Could not record that. The proposal is still waiting for you.";
}
