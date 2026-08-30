import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback } from "react";

import { AppScreen } from "@/components/AppScreen";
import { FeedbackState, LoadingState, StatusMessage } from "@/components/ui";
import { QueueItemDetails } from "@/features/device-capture/components/queue/QueueItemDetails";
import { useCapturePreviewSecurity } from "@/features/device-capture/context/CapturePreviewSecurity";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import { useLocalCapturePreviews } from "@/features/device-capture/hooks/useLocalCapturePreviews";
import RelayDeviceIngress, { type SmsCapturePreview } from "@/modules/relay-device-ingress";

export default function SmsQueueItemScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const capture = useDeviceCaptureCapabilities();
  const security = useCapturePreviewSecurity();
  const enabled =
    capture.mode.developmentLocal && security.ready && capture.mode.tenantId !== undefined;
  const load = useCallback(
    () =>
      capture.mode.tenantId === undefined
        ? Promise.resolve<SmsCapturePreview[]>([])
        : RelayDeviceIngress.getSmsCapturePreviews(capture.mode.tenantId),
    [capture.mode.tenantId],
  );
  const previews = useLocalCapturePreviews({
    enabled,
    errorMessage: "Could not read the encrypted SMS queue.",
    load,
  });
  const item = previews.captures.find((preview) => preview.envelopeId === id);
  const error =
    (!capture.mode.developmentLocal
      ? "Queue-item previews are available only in local diagnostic mode."
      : undefined) ??
    security.error ??
    previews.error;

  return (
    <AppScreen
      backLabel="Back to SMS queue"
      detail="Permitted metadata decrypted only while this secure local screen is visible."
      onBack={() => router.back()}
      title="SMS details"
    >
      <StatusMessage tone="warning">
        Sensitive preview fields are protected from screenshots and cleared when this screen loses
        focus.
      </StatusMessage>
      {error !== undefined ? (
        <FeedbackState detail={error} kind="error" title="Could not read this item" />
      ) : !enabled || previews.refreshing ? (
        <LoadingState label="Reading encrypted SMS..." />
      ) : item === undefined ? (
        <FeedbackState
          detail="The item may have synchronized, been removed, or no longer be ready to retry."
          title="Queue item unavailable"
        />
      ) : (
        <QueueItemDetails
          details={[
            { label: "Sender", value: item.sender },
            { label: "Message body", value: item.body },
            { label: "Captured at", value: item.capturedAt },
            { label: "Processing state", value: "Pending" },
            { label: "Attempts", value: item.attempts.toString() },
            { label: "Relay action ID", value: item.envelopeId },
          ]}
        />
      )}
    </AppScreen>
  );
}
