import { useRouter } from "expo-router";
import { useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  AppButton,
  AppIconButton,
  AppSwitch,
  AppText,
  ContextualNotice,
  StatusMessage,
} from "@/components/ui";
import { SourceConsentDialog } from "@/features/device-capture/components/source/SourceConsentDialog";
import { SourceDisclosureDialog } from "@/features/device-capture/components/source/SourceDisclosureDialog";
import { SourceStatusLabel } from "@/features/device-capture/components/source/SourceStatusLabel";
import { useSmsCaptureController } from "@/features/device-capture/hooks/useSmsCaptureController";
import { smsStatus } from "@/features/device-capture/models/capturePresentation";
import { smsDisclosure } from "@/features/device-capture/models/sourceCatalog";
import {
  sourceQueueRoutes,
  sourceSelectorRoutes,
} from "@/features/device-capture/models/sourceRoutes";
import { ReceiptStage } from "@/features/inbox/components/ReceiptStage";

/**
 * The SMS source and its boundary.
 *
 * Carries the same shape as the notification source: capture is a switch, the allowlist is its own
 * stage, and consent stays a dialog because it is a disclosure obligation rather than a
 * confirmation. Capture is configured as paused before Android permission is requested, so the
 * switch cannot turn on ahead of the grant it depends on.
 */
export default function SmsSourceScreen() {
  const router = useRouter();
  const controller = useSmsCaptureController();
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const disclosure = smsDisclosure(controller.mode.developmentLocal);
  const capabilities = controller.capabilities;
  const available = capabilities?.smsAvailable === true;
  const selectedCount = capabilities?.smsAllowedSenders.length ?? 0;
  const capturing = capabilities?.smsPermissionGranted === true && !capabilities.smsCapturePaused;

  return (
    <ReceiptScreen
      action={
        <AppIconButton
          accessibilityHint="Explains SMS privacy boundaries"
          accessibilityLabel="Android SMS privacy information"
          icon="information-outline"
          onPress={() => setDisclosureVisible(true)}
        />
      }
      onBack={() => router.back()}
      title="Android SMS"
    >
      <SourceStatusLabel status={smsStatus(capabilities)} />

      {capabilities !== undefined && !available ? (
        <ContextualNotice accessibilityLabel="Why SMS capture is unavailable" tone="warning">
          Not in this build. Install the reviewed sideload APK to test SMS capture.
        </ContextualNotice>
      ) : null}

      {controller.error === undefined ? null : (
        <StatusMessage tone="error">{controller.error}</StatusMessage>
      )}
      {controller.message === undefined ? null : (
        <StatusMessage
          tone={
            controller.message.includes("enabled") || controller.message.includes("paused")
              ? "success"
              : "error"
          }
        >
          {controller.message}
        </StatusMessage>
      )}

      <ReceiptStage label="Capture" ordinal={1}>
        <AppSwitch
          accessibilityHint={
            capturing
              ? "Stops capturing new messages immediately"
              : "Opens the consent notice before capture resumes"
          }
          detail={
            capturing
              ? "Capturing. Changes apply before any new SMS enters the encrypted queue."
              : "Paused. Nothing new is captured, and what was already queued is untouched."
          }
          disabled={!available || controller.busy || selectedCount === 0}
          label={capturing ? "Capturing" : "Paused"}
          onValueChange={(next) => {
            if (next) controller.openConsent();
            else void controller.pause();
          }}
          value={capturing}
        />
        {available && selectedCount === 0 ? (
          <AppText tone="muted" variant="caption">
            No contacts are selected, so capture has nothing to read. Choose contacts below first.
          </AppText>
        ) : null}
      </ReceiptStage>

      <ReceiptStage label="Contact allowlist" ordinal={2}>
        <AppText tone="muted" variant="mono">
          {`${String(selectedCount)} ${selectedCount === 1 ? "contact" : "contacts"} · incoming only`}
        </AppText>
        <AppText tone="muted" variant="caption">
          Android owns contact search. Relay receives only the contact row you choose and never
          requests the full contacts database.
        </AppText>
        <AppButton
          disabled={!available}
          label="Manage contacts"
          onPress={() => router.push(sourceSelectorRoutes.sms)}
          tone="secondary"
        />
      </ReceiptStage>

      <ReceiptStage label="Queue" ordinal={3}>
        <AppText tone="muted" variant="mono">
          {`${String(capabilities?.smsQueuedCount ?? 0)} queued`}
        </AppText>
        <AppText tone="muted" variant="caption">
          Review permitted metadata and manage encrypted queued SMS on a dedicated secure screen.
        </AppText>
        <AppButton
          disabled={!available}
          label="Open SMS queue"
          onPress={() => router.push(sourceQueueRoutes.sms)}
          tone="secondary"
        />
      </ReceiptStage>

      <SourceDisclosureDialog
        disclosure={disclosure}
        onDismiss={() => setDisclosureVisible(false)}
        sourceName="Android SMS"
        visible={disclosureVisible}
      />
      <SourceConsentDialog
        actionLabel={
          controller.intent === "authorize" ? "Grant access and sync" : "Resume and sync"
        }
        disclosure={disclosure}
        loading={controller.busy}
        onCancel={controller.closeConsent}
        onConfirm={() => void controller.confirmConsent()}
        sourceName="Android SMS"
        visible={controller.consentVisible}
      />
    </ReceiptScreen>
  );
}
