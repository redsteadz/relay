import type { AccountDeletionStatus } from "@relay/contracts";
import { useState } from "react";

import { Panel } from "@/components/Panel";
import { AppButton, AppText } from "@/components/ui";

import { AccountDeletionDialog } from "./AccountDeletionDialog";

type AccountDeletionPanelProps = {
  deleting: boolean;
  error: unknown;
  onDelete: () => Promise<void>;
  status: AccountDeletionStatus | null | undefined;
};

export function AccountDeletionPanel({
  deleting,
  error,
  onDelete,
  status,
}: AccountDeletionPanelProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Panel
      title="Delete account"
      meta={status === null || status === undefined ? "IRREVERSIBLE" : status.state.toUpperCase()}
    >
      <AppText tone="muted">
        Deletion is resumable if interrupted. It cannot leave active credentials in Relay, and a
        provider revocation failure does not preserve Relay's encrypted copy.
      </AppText>
      {status === null || status === undefined ? null : (
        <AppText tone="warning">
          Attempt {status.attemptCount.toString()} is {status.state.replace("_", " ")}.
        </AppText>
      )}
      <AppButton
        label="Delete Relay account"
        onPress={() => setConfirming(true)}
        tone="destructive"
      />
      <AccountDeletionDialog
        deleting={deleting}
        error={error}
        onDelete={async () => {
          await onDelete();
          setConfirming(false);
        }}
        onDismiss={() => {
          if (!deleting) setConfirming(false);
        }}
        visible={confirming}
      />
    </Panel>
  );
}
