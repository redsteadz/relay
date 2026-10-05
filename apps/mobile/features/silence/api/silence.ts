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

export class NotificationSilenceError extends AppError {
  constructor(cause: unknown, operation: string) {
    super("Notification silencing request failed", {
      category: "database",
      cause,
      code: "NOTIFICATION_SILENCE_REQUEST_FAILED",
      integration: "supabase-postgrest",
      operation,
      retryable: true,
    });
    this.name = "NotificationSilenceError";
  }
}

function silenceError(cause: unknown, operation: string): NotificationSilenceError {
  const normalized = new NotificationSilenceError(cause, operation);
  logMobileError("notification.silence_request_failed", normalized, {
    code: normalized.code,
    integration: "supabase-postgrest",
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
 * Re-running restarts it and discards the evidence, which is what choosing a different action needs:
 * what a person watched a snoozing rule do is not evidence about the same rule cancelling.
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

/** The enable transition, and the per-rule disable that reverses it. */
export async function setRuleDismissal(
  client: SupabaseClient,
  filterRuleId: string,
  enabled: boolean,
): Promise<void> {
  await callRoutine(client, "set_notification_dismissal_v1", {
    p_enabled: enabled,
    p_filter_rule_id: filterRuleId,
  });
}

/** The tenant-wide stop, durable across devices. The device's own copy is engaged first. */
export async function setKillSwitch(client: SupabaseClient, engaged: boolean): Promise<void> {
  await callRoutine(client, "set_notification_dismissal_kill_switch_v1", { p_engaged: engaged });
}
