import { useCallback, useState } from "react";

import { ConfirmationDialog } from "@/components/ui";
import { runInBackground } from "@/lib/observability";

/**
 * Puts one confirmation between a tap on Approve and the recorded decision.
 *
 * Approval is the only inbox control whose effect leaves Relay: once recorded, a Workflow sends the
 * action to its provider, and nothing on this device can call it back. Skip stays one tap because
 * it only cancels something that never left.
 */
export function useConfirmedApproval(approve: (actionRunId: string) => Promise<void>) {
  const [pending, setPending] = useState<string | undefined>();

  const request = useCallback((actionRunId: string) => setPending(actionRunId), []);

  const dialog = (
    <ConfirmationDialog
      confirmLabel="Approve and send"
      confirmTone="primary"
      detail="Relay will send this action to the connected service. Once it is sent it cannot be undone from Relay."
      onCancel={() => setPending(undefined)}
      onConfirm={() => {
        const actionRunId = pending;
        setPending(undefined);
        // The hook restores the proposal and shows its fixed error; this records the failure once.
        if (actionRunId !== undefined) {
          runInBackground(approve(actionRunId), "ui.action_approve_failed", {
            code: "ACTION_APPROVE_FAILED",
            integration: "supabase-postgrest",
            operation: "decideActionRun",
          });
        }
      }}
      title="Approve this action?"
      visible={pending !== undefined}
    />
  );

  return { dialog, request };
}
