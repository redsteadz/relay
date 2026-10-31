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
import { BackgroundDeliveryPanel } from "@/features/device-capture/components/source/BackgroundDeliveryPanel";
import { SourceConsentDialog } from "@/features/device-capture/components/source/SourceConsentDialog";
import { SourceDisclosureDialog } from "@/features/device-capture/components/source/SourceDisclosureDialog";
import { SourceStatusLabel } from "@/features/device-capture/components/source/SourceStatusLabel";
import { useNotificationCaptureController } from "@/features/device-capture/hooks/useNotificationCaptureController";
import {
  captureSwitchCopy,
  notificationControlIntent,
  notificationStatus,
} from "@/features/device-capture/models/capturePresentation";
import { notificationDisclosure } from "@/features/device-capture/models/sourceCatalog";
import {
  sourceQueueRoutes,
  sourceSelectorRoutes,
} from "@/features/device-capture/models/sourceRoutes";
import { ReceiptStage } from "@/features/inbox/components/ReceiptStage";

/**
 * The notification source and its boundary.
 *
 * Capture is a switch on the page rather than an action inside a settings dialog. Pausing a source
 * is the control a person reaches for when they want capture to stop now, and burying the one
 * urgent control two taps behind a gear was the wrong shape for it.
 *
 * Turning capture back on still goes through the consent dialog. Consent is a disclosure
 * requirement, not a confirmation step, so it cannot be reduced to a switch even when pausing can.
 */
export default function NotificationSourceScreen() {
  const router = useRouter();
  const controller = useNotificationCaptureController();
  const [disclosureVisible, setDisclosureVisible] = useState(false);
  const disclosure = notificationDisclosure(controller.mode.developmentLocal);
  const capabilities = controller.capabilities;
  const allowedCount = capabilities?.notificationAllowedPackages.length ?? 0;
  const unsupported = capabilities !== undefined && capabilities.platform !== "android";
  const capturing =
    capabilities?.notificationListener === true && !capabilities.notificationCapturePaused;
  const switchCopy = captureSwitchCopy(
    "notifications",
    capabilities === undefined
      ? undefined
      : unsupported
        ? "unavailable"
        : notificationControlIntent(capabilities),
  );

  return (
    <ReceiptScreen
      action={
        <AppIconButton
          accessibilityHint="Explains notification privacy boundaries"
          accessibilityLabel="Android notification privacy information"
          icon="information-outline"
          onPress={() => setDisclosureVisible(true)}
        />
      }
      onBack={() => router.back()}
      title="Android notifications"
    >
      <SourceStatusLabel status={notificationStatus(capabilities)} />

      {unsupported ? (
        <ContextualNotice
          accessibilityLabel="Why notification capture is unavailable"
          tone="warning"
        >
          Notification capture requires Android. This device can review the source boundary only.
        </ContextualNotice>
      ) : null}

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

      <ReceiptStage label="Capture" ordinal={1}>
        <AppSwitch
          accessibilityHint={switchCopy.hint}
          detail={switchCopy.detail}
          disabled={capabilities === undefined || unsupported || controller.busy}
          label={switchCopy.label}
          onValueChange={(next) => {
            if (next) controller.openConsent();
            else void controller.pause();
          }}
          value={capturing}
        />
        {allowedCount === 0 && !unsupported ? (
          <AppText tone="muted" variant="caption">
            No apps yet. Name an app in a rule, or choose apps below.
          </AppText>
        ) : null}
        <AppButton
          label="Open Android access settings"
          onPress={() => void controller.openSystemSettings()}
          tone="secondary"
        />
      </ReceiptStage>

      <ReceiptStage label="Allowlist" ordinal={2}>
        <AppText tone="muted" variant="mono">
          {`${String(allowedCount)} ${allowedCount === 1 ? "app" : "apps"} · title and visible text only`}
        </AppText>
        <AppText tone="muted" variant="caption">
          Installed app labels and the full launchable-app list remain on this device.
        </AppText>
        <AppButton
          disabled={capabilities === undefined || unsupported}
          label="Manage apps"
          onPress={() => router.push(sourceSelectorRoutes.notifications)}
          tone="secondary"
        />
      </ReceiptStage>

      <ReceiptStage label="Delivery" ordinal={3}>
        <BackgroundDeliveryPanel />
      </ReceiptStage>

      <ReceiptStage label="Queue" ordinal={4}>
        <AppText tone="muted" variant="caption">
          Review permitted metadata and processing state on a dedicated secure screen.
        </AppText>
        <AppButton
          disabled={capabilities === undefined}
          label="Open notification queue"
          onPress={() => router.push(sourceQueueRoutes.notifications)}
          tone="secondary"
        />
      </ReceiptStage>

      <ReceiptStage label="Quiet" ordinal={5}>
        <AppText tone="muted" variant="caption">
          Snooze or clear the notifications a rule matches. Relay keeps its own copy.
        </AppText>
        <AppButton
          label="Open quiet controls"
          onPress={() => router.push("/quiet")}
          tone="secondary"
        />
      </ReceiptStage>

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
    </ReceiptScreen>
  );
}
