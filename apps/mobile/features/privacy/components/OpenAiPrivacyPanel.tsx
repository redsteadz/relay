import type { OpenAiCredentialStatus } from "@relay/contracts";
import { useState } from "react";

import { Panel } from "@/components/Panel";
import { AppButton, AppText, ConfirmationDialog, StatusMessage } from "@/components/ui";

import { formatPrivacyDate, privacyErrorMessage } from "../models/privacyPresentation";

type OpenAiPrivacyPanelProps = {
  error: unknown;
  loading: boolean;
  onRevoke: () => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  revoking: boolean;
  status: OpenAiCredentialStatus | undefined;
};

export function OpenAiPrivacyPanel({
  error,
  loading,
  onRevoke,
  onRetry,
  revoking,
  status,
}: OpenAiPrivacyPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const meta = loading
    ? "CHECKING"
    : error !== null
      ? "UNAVAILABLE"
      : status?.configured === true
        ? "CONFIGURED"
        : "NOT CONFIGURED";

  async function revoke() {
    try {
      await onRevoke();
      setRevoked(true);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Panel title="OpenAI key" meta={meta}>
      <AppText tone="muted">
        Relay stores the key encrypted and uses it only after deterministic filters cannot decide.
        Revoking deletes Relay's stored credential.
      </AppText>
      {loading ? <AppText tone="muted">Checking credential status...</AppText> : null}
      {status?.lastValidatedAt === undefined ? null : (
        <AppText tone="muted">Last validated: {formatPrivacyDate(status.lastValidatedAt)}</AppText>
      )}
      {status?.configured === true ? (
        <AppButton
          label="Revoke OpenAI key"
          onPress={() => setConfirming(true)}
          tone="destructive"
        />
      ) : null}
      {error === null ? null : (
        <>
          <StatusMessage tone="error">{privacyErrorMessage(error)}</StatusMessage>
          <AppButton label="Retry key status" onPress={() => void onRetry()} tone="secondary" />
        </>
      )}
      {revoked ? <StatusMessage tone="success">OpenAI key revoked.</StatusMessage> : null}
      <ConfirmationDialog
        confirmLabel="Revoke key"
        detail="Relay will delete its encrypted copy immediately. Semantic clauses will remain undecided until a new key is configured."
        loading={revoking}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void revoke().catch(() => undefined)}
        title="Revoke OpenAI key?"
        visible={confirming}
      />
    </Panel>
  );
}
