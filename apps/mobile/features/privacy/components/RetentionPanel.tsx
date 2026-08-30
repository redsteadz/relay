import type { PrivacyRetentionStatus } from "@relay/contracts";
import { useState } from "react";

import {
  AppButton,
  AppText,
  ConfirmationDialog,
  EditorialSurface,
  StatusMessage,
} from "@/components/ui";
import { reportUnexpectedUiError } from "@/lib/observability";

import { formatPrivacyDate, privacyErrorMessage } from "../models/privacyPresentation";

type RetentionPanelProps = {
  error: unknown;
  loading: boolean;
  onPurge: () => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  purging: boolean;
  retention: PrivacyRetentionStatus | undefined;
};

export function RetentionPanel({
  error,
  loading,
  onPurge,
  onRetry,
  purging,
  retention,
}: RetentionPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [purgedCount, setPurgedCount] = useState<number>();

  async function purge() {
    try {
      const response = (await onPurge()) as { purgedCount: number };
      setPurgedCount(response.purgedCount);
      setConfirming(false);
    } catch (error: unknown) {
      reportUnexpectedUiError(error, "ui.privacy_raw_purge_failed", {
        code: "PRIVACY_RAW_PURGE_FAILED",
        integration: "relay-api",
        operation: "purgeRawPayloads",
      });
      setConfirming(false);
    }
  }

  return (
    <EditorialSurface
      icon="database-clock-outline"
      title="Raw data retention"
      meta="Fixed · 7 days"
    >
      <AppText tone="muted">
        Encrypted source payloads expire automatically. Purging destroys only recoverable raw
        bodies; derived facts, classifications, events, and provenance remain.
      </AppText>
      {loading ? <AppText tone="muted">Checking retained payloads...</AppText> : null}
      {retention === undefined ? null : (
        <>
          <AppText variant="bodyStrong">
            {retention.retainedCount.toString()} encrypted payload
            {retention.retainedCount === 1 ? "" : "s"} retained
          </AppText>
          <AppText tone="muted">
            Next cleanup: {formatPrivacyDate(retention.earliestExpiresAt)}
          </AppText>
          <AppButton
            disabled={retention.retainedCount === 0}
            label="Purge raw payloads now"
            onPress={() => setConfirming(true)}
            tone="destructive"
          />
        </>
      )}
      {error === null ? null : (
        <>
          <StatusMessage tone="error">{privacyErrorMessage(error)}</StatusMessage>
          <AppButton
            label="Retry retention status"
            onPress={() =>
              void onRetry().catch((error: unknown) =>
                reportUnexpectedUiError(error, "ui.privacy_retention_retry_failed", {
                  code: "PRIVACY_RETENTION_RETRY_FAILED",
                  integration: "relay-api",
                  operation: "retryRetentionStatus",
                }),
              )
            }
            tone="secondary"
          />
        </>
      )}
      {purgedCount === undefined ? null : (
        <StatusMessage tone="success">
          {`Purged ${purgedCount.toString()} encrypted payload${purgedCount === 1 ? "" : "s"}.`}
        </StatusMessage>
      )}
      <ConfirmationDialog
        confirmLabel="Purge raw payloads"
        detail="This permanently destroys retained encrypted source bodies now. Derived facts and their provenance stay available."
        loading={purging}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void purge()}
        title="Purge retained raw data?"
        visible={confirming}
      />
    </EditorialSurface>
  );
}
