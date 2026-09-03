import type { OpenAiCredentialStatus } from "@relay/contracts";
import { router } from "expo-router";
import { useMemo, useState } from "react";

import {
  AppButton,
  AppText,
  ConfirmationDialog,
  EditorialSurface,
  StatusMessage,
} from "@/components/ui";
import { reportUnexpectedUiError } from "@/lib/observability";

import {
  openAiCredentialErrorMessage,
  openAiEndpointSummary,
  openAiKeyFormDefaults,
  openAiPanelMeta,
  semanticDisclosureRules,
  type OpenAiKeyFormValues,
} from "../models/openAiPresentation";
import { formatPrivacyDate, privacyErrorMessage } from "../models/privacyPresentation";
import { OpenAiKeyDialog } from "./OpenAiKeyDialog";

type OpenAiPrivacyPanelProps = {
  error: unknown;
  loading: boolean;
  onRevoke: () => Promise<unknown>;
  onRetry: () => Promise<unknown>;
  onSave: (values: OpenAiKeyFormValues) => Promise<unknown>;
  revoking: boolean;
  saveError: unknown;
  saving: boolean;
  status: OpenAiCredentialStatus | undefined;
};

export function OpenAiPrivacyPanel({
  error,
  loading,
  onRevoke,
  onRetry,
  onSave,
  revoking,
  saveError,
  saving,
  status,
}: OpenAiPrivacyPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [saved, setSaved] = useState(false);
  const configured = status?.configured === true;
  const meta = openAiPanelMeta(loading, error, status);
  const defaults = useMemo(() => openAiKeyFormDefaults(status), [status]);

  async function revoke() {
    try {
      await onRevoke();
      setRevoked(true);
    } finally {
      setConfirming(false);
    }
  }

  async function save(values: OpenAiKeyFormValues) {
    await onSave(values);
    setEditing(false);
    setRevoked(false);
    setSaved(true);
  }

  return (
    <EditorialSurface icon="key-outline" title="Semantic processing" meta={meta}>
      <AppText tone="muted">
        Deterministic filters always run first. A rule reaches a model only when they cannot decide
        it, and only with your own key — Relay ships none. Without a key those rules stay undecided
        and nothing is sent.
      </AppText>

      {loading ? <AppText tone="muted">Checking credential status...</AppText> : null}

      {configured ? (
        <>
          <AppText tone="muted">Endpoint: {openAiEndpointSummary(status.endpoint)}</AppText>
          {status.lastValidatedAt === undefined ? null : (
            <AppText tone="muted">
              Last checked: {formatPrivacyDate(status.lastValidatedAt)}
            </AppText>
          )}
          {status.validated === false ? (
            <StatusMessage tone="warning">
              This endpoint offers no way to check a key, so the key is stored without confirmation.
              It will be exercised the first time a rule needs it.
            </StatusMessage>
          ) : null}
        </>
      ) : (
        <>
          {semanticDisclosureRules.map((rule) => (
            <AppText key={rule} tone="muted" variant="caption">
              {rule}
            </AppText>
          ))}
        </>
      )}

      <AppButton
        label={configured ? "Replace key" : "Add a key"}
        onPress={() => {
          setSaved(false);
          setEditing(true);
        }}
        tone={configured ? "secondary" : "primary"}
      />

      {configured ? (
        <AppButton label="Revoke key" onPress={() => setConfirming(true)} tone="destructive" />
      ) : null}

      <AppButton
        label="View disclosure history"
        onPress={() => router.push("/disclosures")}
        tone="secondary"
      />

      {saved ? <StatusMessage tone="success">Key saved.</StatusMessage> : null}
      {revoked ? (
        <StatusMessage tone="success">
          Key revoked. Rules needing a model now stay undecided.
        </StatusMessage>
      ) : null}

      {error === null || error === undefined ? null : (
        <>
          <StatusMessage tone="error">{privacyErrorMessage(error)}</StatusMessage>
          <AppButton
            label="Retry key status"
            onPress={() =>
              void onRetry().catch((error: unknown) =>
                reportUnexpectedUiError(error, "ui.privacy_openai_retry_failed", {
                  code: "PRIVACY_OPENAI_RETRY_FAILED",
                  integration: "relay-api",
                  operation: "retryOpenAiStatus",
                }),
              )
            }
            tone="secondary"
          />
        </>
      )}

      <OpenAiKeyDialog
        defaults={defaults}
        errorMessage={
          saveError === null || saveError === undefined
            ? undefined
            : openAiCredentialErrorMessage(saveError)
        }
        onDismiss={() => setEditing(false)}
        onSave={(values) =>
          save(values).catch((cause: unknown) => {
            // The mutation surfaces its own failure through `saveError`; this only keeps a rejected
            // promise from going unhandled, and leaves the dialog open so the form can be corrected.
            if (!(cause instanceof Error)) {
              reportUnexpectedUiError(cause, "ui.privacy_openai_save_failed", {
                code: "PRIVACY_OPENAI_SAVE_FAILED",
                integration: "relay-api",
                operation: "saveOpenAiKey",
              });
            }
          })
        }
        replacing={configured}
        saving={saving}
        visible={editing}
      />

      <ConfirmationDialog
        confirmLabel="Revoke key"
        detail="Relay deletes its encrypted copy immediately. Rules that need a model return to undecided, so nothing is acted on without you. Deterministic rules are unaffected, and past disclosures stay in the history."
        loading={revoking}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          void revoke().catch((cause: unknown) =>
            reportUnexpectedUiError(cause, "ui.privacy_openai_revoke_failed", {
              code: "PRIVACY_OPENAI_REVOKE_FAILED",
              integration: "relay-api",
              operation: "revokeOpenAiKey",
            }),
          )
        }
        title="Revoke key?"
        visible={confirming}
      />
    </EditorialSurface>
  );
}
