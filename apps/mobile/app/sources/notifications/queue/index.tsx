import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";

import { SourceQueueScreen } from "@/features/device-capture/components/queue/SourceQueueScreen";
import { useCapturePreviewSecurity } from "@/features/device-capture/context/CapturePreviewSecurity";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import { useLocalCapturePreviews } from "@/features/device-capture/hooks/useLocalCapturePreviews";
import { sourceQueueItemRoute } from "@/features/device-capture/models/sourceRoutes";
import RelayDeviceIngress, {
  type NotificationCapturePreview,
} from "@/modules/relay-device-ingress";

export default function NotificationQueueScreen() {
  const router = useRouter();
  const capture = useDeviceCaptureCapabilities();
  const security = useCapturePreviewSecurity();
  const enabled =
    capture.mode.developmentLocal && security.ready && capture.mode.tenantId !== undefined;
  const load = useCallback(
    () =>
      capture.mode.tenantId === undefined
        ? Promise.resolve<NotificationCapturePreview[]>([])
        : RelayDeviceIngress.getNotificationCapturePreviews(capture.mode.tenantId),
    [capture.mode.tenantId],
  );
  const previews = useLocalCapturePreviews({
    enabled,
    errorMessage: "Could not read the encrypted notification queue.",
    load,
  });
  const items = useMemo(
    () =>
      previews.captures.map((preview) => ({
        attempts: preview.attempts,
        capturedAt: preview.capturedAt,
        id: preview.envelopeId,
        label: preview.applicationId ?? "Android app",
        searchText: `${preview.applicationId ?? "Android app"} pending`,
        status: "Pending" as const,
        summary: "Notification captured",
      })),
    [previews.captures],
  );
  const emptyMessage = capture.mode.developmentLocal
    ? "No pending notification captures reached the local queue."
    : "Authenticated captures synchronize in the background. Readable queue previews are limited to local diagnostic mode.";

  return (
    <SourceQueueScreen
      detail="Encrypted notification work waiting on this device. Visible fields are minimized and never logged."
      emptyMessage={emptyMessage}
      error={security.error ?? previews.error ?? capture.error}
      items={items}
      loading={
        capture.capabilities === undefined ||
        capture.refreshing ||
        (capture.mode.developmentLocal && !security.ready)
      }
      offlineMessage="Queued captures remain encrypted on this device while offline and retry when synchronization is available."
      onBack={() => router.back()}
      onItemPress={(item) => router.push(sourceQueueItemRoute("notifications", item.id))}
      onRefresh={previews.refresh}
      title="Notification queue"
    />
  );
}
