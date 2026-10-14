/**
 * Reading and changing what a rule is allowed to do to a notification.
 *
 * The authorization lives in `notification_dismissal_authorizations`, beside the revision rather
 * than on it. A filter revision is immutable -- `filter_rules_enforce_immutability` refuses every
 * update to the table -- so a dry run that completes days later could not have been recorded on that
 * row. Keying the authorization to a revision id also means an edit withdraws it: a new revision
 * simply has no row.
 *
 * Writes go through security-definer routines rather than PostgREST, for the same reason
 * `decide_action_run` does: the table is read-only to clients, and the routines validate the plan
 * shape, the explicit application predicate, and the server-clocked dry-run window, then write
 * `audit_log` in the same statement as the change. There is no HTTP endpoint in between: the tenant
 * acts as the authenticated Supabase role, so authorization never passes through a service that
 * could substitute its own tenant identity.
 */

import {
  notificationDismissalSettingsSchema,
  type NotificationSilenceAction,
} from "@relay/contracts";
import { AppError } from "@relay/observability";
import type { SupabaseClient } from "@supabase/supabase-js";

import { logMobileError } from "@/lib/observability";
import type { SilenceAuthorization } from "@/lib/notification-silence";

/** Mirrors `notification_dismissal_dry_run_minimum()`. The database remains the authority. */
export const SILENCE_DRY_RUN_MINIMUM_HOURS = 72;

// One string literal each, not a concatenation: PostgREST's column list is parsed at the type level,
// so splitting it across expressions loses the row type.
const revisionColumns = "id, series_id, name, plan, version, enabled";
const authorizationColumns =
  "filter_rule_id, action, dry_run_started_at, dry_run_completed_at, authorized_at, observed_count, matched_count";

type RevisionRow = {
  enabled: boolean;
  id: string;
  name: string;
  plan: unknown;
  series_id: string;
  version: number;
};

type AuthorizationRow = {
  action: NotificationSilenceAction;
  authorized_at: string | null;
  dry_run_completed_at: string | null;
  dry_run_started_at: string;
  filter_rule_id: string;
  matched_count: number | null;
  observed_count: number | null;
};

/**
 * What a refusal from one of the routines means, in words a person can act on.
 *
 * The routines refuse for a small, fixed set of reasons, each of which is a property of the rule or
 * its state rather than an incident. Mapping their SQLSTATE to a deterministic message is what keeps
 * the screen from reporting "could not be saved" for a rule that will never be savable -- while
 * still never putting the database's own text in front of a reader.
 */
const REFUSAL_MESSAGES: Record<string, string> = {
  // `22023` is now one case: a plan with neither a deterministic nor a semantic part, which decides
  // nothing. The compiler catches that first and says so, which leaves one way to reach this --
  // the database is running an older routine than this build expects, with gates the compiler no
  // longer applies (ADR-0020). So the message says that rather than naming a rule shape the reader
  // would try, and fail, to correct.
  "22023":
    "Your account will not allow this rule to clear notifications yet. Relay on this phone is ahead of the server; this should resolve on its own.",
  // `P0002` is a state refusal: the rule is switched off, the window is not over, or there is no
  // window yet.
  P0002:
    "This rule is not in a state where that is allowed yet. Reopen this screen to see where it stands.",
  "42501": "Relay needs you signed in to change this.",
};

function refusalMessage(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null) return undefined;
  const code = (cause as { code?: unknown }).code;
  return typeof code === "string" ? REFUSAL_MESSAGES[code] : undefined;
}

export class NotificationSilenceError extends AppError {
  constructor(cause: unknown, operation: string) {
    const refusal = refusalMessage(cause);
    super("Notification silencing request failed", {
      // A refusal is the database declining a transition, not a fault to retry. Classifying it as
      // such keeps it out of the retryable bucket and gives it its own message.
      category: refusal === undefined ? "database" : "validation",
      cause,
      code:
        refusal === undefined
          ? "NOTIFICATION_SILENCE_REQUEST_FAILED"
          : "NOTIFICATION_SILENCE_REFUSED",
      integration: "supabase-postgrest",
      operation,
      retryable: refusal === undefined,
      ...(refusal === undefined ? {} : { userMessage: refusal }),
    });
    this.name = "NotificationSilenceError";
  }
}

function silenceError(cause: unknown, operation: string): NotificationSilenceError {
  const normalized = new NotificationSilenceError(cause, operation);
  logMobileError("notification.silence_request_failed", normalized, {
    code: normalized.code,
    integration: "supabase-postgrest",
    metadata: { refused: normalized.code === "NOTIFICATION_SILENCE_REFUSED" },
    operation,
  });
  return normalized;
}

function authorizationFor(
  revision: RevisionRow,
  granted: AuthorizationRow | undefined,
): SilenceAuthorization {
  return {
    // The default a rule gets before anyone has chosen: the reversible one.
    action: granted?.action ?? "snooze",
    authorized: granted?.authorized_at != null,
    dryRunCompletedAt: granted?.dry_run_completed_at ?? undefined,
    dryRunStartedAt: granted?.dry_run_started_at ?? undefined,
    enabled: revision.enabled,
    id: revision.id,
    name: revision.name,
    plan: revision.plan,
    seriesId: revision.series_id,
    version: revision.version,
  };
}

/**
 * Every revision, with whatever authorization it holds.
 *
 * Two reads rather than an embed, because the interesting case is the revision with no authorization
 * row -- most of them -- and a left join expressed through PostgREST's embedding is harder to read
 * than a merge here.
 *
 * All revisions rather than only the newest, because `compileSilencePlan` picks the newest of each
 * series itself and an earlier revision has to stay visible after an edit withdraws its
 * authorization.
 */
export async function listSilenceAuthorizations(
  client: SupabaseClient,
): Promise<SilenceAuthorization[]> {
  const revisions = await client
    .from("filter_rules")
    .select(revisionColumns)
    .order("name", { ascending: true })
    .order("version", { ascending: false });
  if (revisions.error !== null) throw silenceError(revisions.error, "listSilenceAuthorizations");

  const granted = await client
    .from("notification_dismissal_authorizations")
    .select(authorizationColumns);
  if (granted.error !== null) {
    throw silenceError(granted.error, "listSilenceAuthorizations.authorizations");
  }

  const byRule = new Map<string, AuthorizationRow>();
  for (const row of granted.data as AuthorizationRow[]) byRule.set(row.filter_rule_id, row);
  return (revisions.data as RevisionRow[]).map((revision) =>
    authorizationFor(revision, byRule.get(revision.id)),
  );
}

/** The tenant-wide stop, as the database holds it. No row means never engaged. */
export async function readDismissalSettings(client: SupabaseClient): Promise<boolean> {
  const { data, error } = await client
    .from("notification_dismissal_settings")
    .select("kill_switch_engaged, updated_at")
    .maybeSingle();
  if (error !== null) throw silenceError(error, "readDismissalSettings");
  if (data === null) return false;

  const parsed = notificationDismissalSettingsSchema.safeParse({
    killSwitchEngaged: (data as { kill_switch_engaged: boolean }).kill_switch_engaged,
    updatedAt: (data as { updated_at: string }).updated_at,
  });
  if (!parsed.success) throw silenceError(parsed.error, "readDismissalSettings.contract");
  return parsed.data.killSwitchEngaged;
}

async function callRoutine(
  client: SupabaseClient,
  routine: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.rpc(routine, parameters);
  if (error !== null) throw silenceError(error, routine);
}

/**
 * Opens the observation window for one action.
 *
 * Optional since [ADR-0021](../../../../docs/decisions/0021-direct-quiet-authorization.md): a
 * reader who already knows what their rule does can authorize it directly. This is for the one who
 * wants to see it decide first.
 *
 * Re-running restarts it and discards the evidence. Changing the action no longer requires that --
 * `setRuleDismissal` takes an action and changes it in place.
 */
export async function startDryRun(
  client: SupabaseClient,
  filterRuleId: string,
  action: NotificationSilenceAction,
): Promise<void> {
  await callRoutine(client, "start_notification_dismissal_dry_run_v1", {
    p_action: action,
    p_filter_rule_id: filterRuleId,
  });
}

/**
 * Closes the window, carrying what the device observed.
 *
 * The counts are evidence recorded in the audit record, not the gate. The gate is the elapsed
 * window, measured on the server clock between two routine calls, because a device that reported
 * its own window could report one it never ran.
 */
export async function completeDryRun(
  client: SupabaseClient,
  filterRuleId: string,
  counts: { matched: number; observed: number },
): Promise<void> {
  await callRoutine(client, "complete_notification_dismissal_dry_run_v1", {
    p_filter_rule_id: filterRuleId,
    p_matched: counts.matched,
    p_observed: counts.observed,
  });
}

/**
 * The enable transition, the per-rule disable that reverses it, and the action either carries.
 *
 * No dry run is required. The routine upserts, so a reader who never watched the rule still gets an
 * authorization row, and `action` omitted keeps whatever is stored -- turning a rule off and on
 * again must not silently change what it does to a notification.
 */
export async function setRuleDismissal(
  client: SupabaseClient,
  filterRuleId: string,
  enabled: boolean,
  action?: NotificationSilenceAction,
): Promise<void> {
  await callRoutine(client, "set_notification_dismissal_v1", {
    ...(action === undefined ? {} : { p_action: action }),
    p_enabled: enabled,
    p_filter_rule_id: filterRuleId,
  });
}

/** The tenant-wide stop, durable across devices. The device's own copy is engaged first. */
export async function setKillSwitch(client: SupabaseClient, engaged: boolean): Promise<void> {
  await callRoutine(client, "set_notification_dismissal_kill_switch_v1", { p_engaged: engaged });
}
