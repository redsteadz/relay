import { useRouter } from "expo-router";
import { useState } from "react";

import { AppScreen } from "@/components/AppScreen";
import {
  AppButton,
  AppIconButton,
  AppText,
  EditorialSurface,
  StatusMessage,
} from "@/components/ui";
import { SourceConsentDialog } from "@/features/device-capture/components/source/SourceConsentDialog";
import { SourceDisclosureDialog } from "@/features/device-capture/components/source/SourceDisclosureDialog";
import { SourceSettingsDialog } from "@/features/device-capture/components/source/SourceSettingsDialog";
import { SourceStatusLabel } from "@/features/device-capture/components/source/SourceStatusLabel";
import { useSmsCaptureController } from "@/features/device-capture/hooks/useSmsCaptureController";
import { smsStatus } from "@/features/device-capture/models/capturePresentation";
import { smsDisclosure } from "@/features/device-capture/models/sourceCatalog";
import {
  sourceQueueRoutes,
  sourceSelectorRoutes,
} from "@/features/device-capture/models/sourceRoutes";

export default function SmsSourceScreen() {
  const router = useRouter();
  const controller = useSmsCaptureController();
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const disclosure = smsDisclosure(controller.mode.developmentLocal);
  const capabilities = controller.capabilities;
  const available = capabilities?.smsAvailable === true;
  const selectedCount = capabilities?.smsAllowedSenders.length ?? 0;
  const smsActive = capabilities?.smsPermissionGranted === true && !capabilities.smsCapturePaused;

  function afterSettings(action: () => void) {
    setSettingsVisible(false);
    requestAnimationFrame(action);
  }

  return (
    <AppScreen
      action={
        <AppIconButton
          accessibilityHint="Opens SMS source controls"
          accessibilityLabel="Android SMS settings"
          disabled={!available || controller.busy}
          icon="cog-outline"
          onPress={() => setSettingsVisible(true)}
        />
      }
      backLabel="Back to Sources"
      detail="Capture incoming SMS from contacts you explicitly select."
      onBack={() => router.back()}
      title="Android SMS"
      titleAccessory={
        <AppIconButton
          accessibilityHint="Explains SMS privacy boundaries"
          accessibilityLabel="Android SMS privacy information"
          icon="information-outline"
          onPress={() => setDisclosureVisible(true)}
        />
      }
    >
      <SourceStatusLabel status={smsStatus(capabilities)} />
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
      {capabilities !== undefined && !available ? (
        <StatusMessage tone="warning">
          NOT IN THIS BUILD. Install the reviewed sideload APK to test SMS capture.
        </StatusMessage>
      ) : null}
      <EditorialSurface
        icon="account-multiple-outline"
        meta={`${selectedCount.toString()} SELECTED`}
        title="Contact allowlist"
      >
        <AppText tone="muted">
          Android owns contact search. Relay receives only the contact row you choose and never
          requests the full contacts database.
        </AppText>
        <AppButton
          disabled={!available}
          label="Manage contacts"
          onPress={() => router.push(sourceSelectorRoutes.sms)}
          tone="secondary"
        />
      </EditorialSurface>
      <EditorialSurface icon="sync" title="Access and synchronization">
        <AppText tone="muted">
          Relay configures capture as paused before requesting Android permission, then synchronizes
          only after access is granted.
        </AppText>
        <AppButton
          disabled={!available || selectedCount === 0 || smsActive}
          label={
            smsActive
              ? "SMS capture active"
              : capabilities?.smsPermissionGranted
                ? "Review consent and resume"
                : "Grant SMS access and sync"
          }
          onPress={controller.openConsent}
        />
      </EditorialSurface>
      <EditorialSurface
        icon="format-list-bulleted"
        meta={`${(capabilities?.smsQueuedCount ?? 0).toString()} QUEUED`}
        title="SMS queue"
      >
        <AppText tone="muted">
          Review permitted metadata and manage encrypted queued SMS on a dedicated secure screen.
        </AppText>
        <AppButton
          disabled={!available}
          label="Open SMS queue"
          onPress={() => router.push(sourceQueueRoutes.sms)}
          tone="secondary"
        />
      </EditorialSurface>
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
      <SourceSettingsDialog
        actions={[
          capabilities?.smsCapturePaused === true
            ? {
                key: "resume",
                label:
                  controller.intent === "authorize"
                    ? "Grant SMS access and sync"
                    : "Resume capture",
                onPress: () => afterSettings(controller.openConsent),
              }
            : {
                disabled: controller.busy || selectedCount === 0,
                key: "pause",
                label: "Pause capture",
                onPress: () => afterSettings(() => void controller.pause()),
              },
        ]}
        detail="Pause capture before any new SMS enters the encrypted queue, or resume through the consent boundary."
        onDismiss={() => setSettingsVisible(false)}
        sourceName="Android SMS"
        visible={settingsVisible}
      />
    </AppScreen>
  );
}
