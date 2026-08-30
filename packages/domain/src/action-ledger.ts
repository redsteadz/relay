import type { ActionDecision, ActionRunStatus } from "@relay/contracts";

/**
 * Namespace for deterministic action-run identity.
 *
 * Itself the UUIDv5 of "relay.action-run.v1" under the standard DNS namespace, so it is reproducible
 * from a label rather than an arbitrary constant. It must stay byte-identical to the value in
 * `supabase/migrations/202608300003_action_approval_ledger.sql`.
 */
const ACTION_RUN_NAMESPACE = "aa8114f6-a193-573c-91f9-966134b550ca";

function uuidBytes(value: string): Uint8Array {
  return Uint8Array.from(value.replace(/-/gu, "").match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

/** RFC 4122 UUIDv5 over a namespace and a raw name. */
export async function uuidV5(namespace: string, name: Uint8Array): Promise<string> {
  const prefix = uuidBytes(namespace);
  const input = new Uint8Array(prefix.byteLength + name.byteLength);
  input.set(prefix);
  input.set(name, prefix.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Derives the stable action-run identity for one rule and event pair.
 *
 * Mirrors `public.relay_action_run_id`, which remains the authority: the database enforces the same
 * derivation as a check constraint, so a row whose id disagrees with this cannot exist. Having it
 * here lets a caller derive a provider idempotency key before the row is written, and lets a
 * redelivered message recognise the action it already proposed without a round trip.
 *
 * The identifiers are joined by a zero byte so no pair of inputs can concatenate into another
 * pair's name.
 */
export async function relayActionRunId(actionRuleId: string, eventId: string): Promise<string> {
  const rule = new TextEncoder().encode(actionRuleId.toLowerCase());
  const event = new TextEncoder().encode(eventId.toLowerCase());
  const name = new Uint8Array(rule.byteLength + 1 + event.byteLength);
  name.set(rule);
  name[rule.byteLength] = 0;
  name.set(event, rule.byteLength + 1);
  return uuidV5(ACTION_RUN_NAMESPACE, name);
}

/**
 * Statuses from which a user decision is still meaningful.
 *
 * Approval only applies before an action starts; cancellation stays available until it does. Mirrors
 * the transition checks in `decide_action_run`, which remains the authority because it holds a row
 * lock while it decides. This exists so a client can grey out a control without guessing, and so the
 * table is stated once in a form tests can enumerate.
 */
export const ACTION_DECISION_SOURCE_STATUSES: Readonly<
  Record<ActionDecision, readonly ActionRunStatus[]>
> = Object.freeze({
  approve: Object.freeze(["awaiting-approval"] as const),
  cancel: Object.freeze(["proposed", "awaiting-approval", "approved"] as const),
});

/** Whether a decision is available from a status. */
export function canDecideActionRun(status: ActionRunStatus, decision: ActionDecision): boolean {
  return ACTION_DECISION_SOURCE_STATUSES[decision].includes(status);
}

/**
 * Whether a Workflow may start from this status.
 *
 * Only `approved` is eligible. A proposal that has not been decided, one already running, and every
 * terminal state are all ineligible, so nothing can start an external effect on the strength of a
 * ledger state that does not record an approval.
 */
export function canClaimActionRun(status: ActionRunStatus): boolean {
  return status === "approved";
}
