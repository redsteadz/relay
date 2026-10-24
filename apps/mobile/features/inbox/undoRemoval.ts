import { logMobileError } from "@/lib/observability";

/** Shown when an undo could not be recorded. Points at the one place the capture can still be found. */
export const UNDO_FAILED_MESSAGE =
  "Could not put that back. It is waiting in Removed items, where you can restore it.";

/**
 * Runs an undo from the inbox's undo offer and makes its failure visible.
 *
 * The offer disappears as soon as it is pressed, so a rejected restore that nobody observed read as
 * a successful undo while the capture stayed removed.
 */
export function undoRemoval(
  restore: (eventId: string) => Promise<void>,
  eventId: string,
  onFailed: (message: string) => void,
): void {
  void restore(eventId).catch((error: unknown) => {
    logMobileError("ui.inbox_undo_failed", error, {
      code: "INBOX_UNDO_FAILED",
      integration: "supabase-postgrest",
      operation: "restoreInboxEvent",
    });
    onFailed(UNDO_FAILED_MESSAGE);
  });
}
