import { useRouter } from "expo-router";
import { useState } from "react";

import { AppScreen } from "@/components/AppScreen";
import {
  ActionRow,
  AppButton,
  AppIconButton,
  AppText,
  ContextualNotice,
  EditorialSurface,
  StatusMessage,
} from "@/components/ui";
import { SourceConsentDialog } from "@/features/device-capture/components/source/SourceConsentDialog";
import { SourceDisclosureDialog } from "@/features/device-capture/components/source/SourceDisclosureDialog";
import { SourceSettingsDialog } from "@/features/device-capture/components/source/SourceSettingsDialog";
import { SourceStatusLabel } from "@/features/device-capture/components/source/SourceStatusLabel";
import { useNotificationCaptureController } from "@/features/device-capture/hooks/useNotificationCaptureController";
import { notificationStatus } from "@/features/device-capture/models/capturePresentation";
import { notificationDisclosure } from "@/features/device-capture/models/sourceCatalog";
import {
  sourceQueueRoutes,
  sourceSelectorRoutes,
} from "@/features/device-capture/models/sourceRoutes";

export default function NotificationSourceScreen() {
  const router = useRouter();
  const controller = useNotificationCaptureController();
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const disclosure = notificationDisclosure(controller.mode.developmentLocal);
  const capabilities = controller.capabilities;
  const allowedCount = capabilities?.notificationAllowedPackages.length ?? 0;
  const unsupported = capabilities !== undefined && capabilities.platform !== "android";
  const notificationActive =
    capabilities?.notificationListener === true && !capabilities.notificationCapturePaused;

  function afterSettings(action: () => void) {
    setSettingsVisible(false);
    requestAnimationFrame(action);
  }

  return (
    <AppScreen
      backLabel="Back to Sources"
      detail="Capture visible notification fields from only the Android apps you approve."
      onBack={() => router.back()}
      title="Android notifications"
      titleAccessory={
        <ActionRow compact wrap={false}>
          <AppIconButton
            accessibilityHint="Explains notification privacy boundaries"
            accessibilityLabel="Android notification privacy information"
            compact
            icon="information-outline"
            onPress={() => setDisclosureVisible(true)}
          />
          <AppIconButton
            accessibilityHint="Opens notification source controls"
            accessibilityLabel="Android notification settings"
            compact
            disabled={capabilities === undefined || controller.busy || unsupported}
            icon="cog-outline"
            onPress={() => setSettingsVisible(true)}
          />
        </ActionRow>
      }
    >
      <ActionRow compact wrap={false}>
        <SourceStatusLabel status={notificationStatus(capabilities)} />
        {unsupported ? (
          <ContextualNotice
            accessibilityLabel="Why notification capture is unavailable"
            tone="warning"
          >
            Notification capture requires Android. This device can review the source boundary only.
          </ContextualNotice>
        ) : null}
      </ActionRow>
      {controller.error === undefined ? null : (
        <StatusMessage tone="error">{controller.error}</StatusMessage>
      )}
      {controller.message === undefined ? null : (
        <StatusMessage
          tone={
            controller.message.includes("paused") || controller.message.includes("resumed")
              ? "success"
              : "error"
          }
        >
          {controller.message}
        </StatusMessage>
      )}
      <EditorialSurface icon="apps" meta={`${allowedCount.toString()} SELECTED`} title="Allowlist">
        <AppText tone="muted">
          Installed app labels and the full launchable-app list remain on this device.
        </AppText>
        <AppButton
          disabled={capabilities === undefined || unsupported}
          label="Manage apps"
          onPress={() => router.push(sourceSelectorRoutes.notifications)}
          tone="secondary"
        />
      </EditorialSurface>
      <EditorialSurface icon="sync" title="Access and synchronization">
        <AppText tone="muted">
          Changes apply before any new item enters the encrypted upload queue.
        </AppText>
        <AppButton
          disabled={allowedCount === 0 || unsupported || notificationActive}
          label={
            notificationActive
              ? "Notification access active"
              : capabilities?.notificationListener
                ? "Review consent and resume"
                : "Continue to Android access"
          }
          onPress={controller.openConsent}
        />
      </EditorialSurface>
      <EditorialSurface
        icon="format-list-bulleted"
        meta={`${(capabilities?.notificationAllowedPackages.length ?? 0).toString()} APPS`}
        title="Notification queue"
      >
        <AppText tone="muted">
          Review permitted metadata and processing state on a dedicated secure screen.
        </AppText>
        <AppButton
          disabled={capabilities === undefined}
          label="Open notification queue"
          onPress={() => router.push(sourceQueueRoutes.notifications)}
          tone="secondary"
        />
      </EditorialSurface>
      <SourceDisclosureDialog
        disclosure={disclosure}
        onDismiss={() => setDisclosureVisible(false)}
        sourceName="Android notifications"
        visible={disclosureVisible}
      />
      <SourceConsentDialog
        actionLabel={controller.intent === "authorize" ? "Open Android settings" : "Resume capture"}
        disclosure={disclosure}
        loading={controller.busy}
        onCancel={controller.closeConsent}
        onConfirm={() => void controller.confirmConsent()}
        sourceName="Android notifications"
        visible={controller.consentVisible}
      />
      <SourceSettingsDialog
        actions={[
          capabilities?.notificationCapturePaused === true
            ? {
                key: "resume",
                label:
                  controller.intent === "authorize"
                    ? "Authorize notification access"
                    : "Resume capture",
                onPress: () => afterSettings(controller.openConsent),
              }
            : {
                disabled: controller.busy || allowedCount === 0,
                key: "pause",
                label: "Pause capture",
                onPress: () => afterSettings(() => void controller.pause()),
              },
          {
            key: "android-settings",
            label: "Open Android access settings",
            onPress: () => afterSettings(controller.openSystemSettings),
          },
        ]}
        detail="Pause capture immediately or manage Relay's notification-listener access in Android settings."
        onDismiss={() => setSettingsVisible(false)}
        sourceName="Android notifications"
        visible={settingsVisible}
      />
    </AppScreen>
  );
}
