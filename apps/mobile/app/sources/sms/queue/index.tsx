import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";

import { AppButton, ConfirmationDialog } from "@/components/ui";
import { SourceQueueScreen } from "@/features/device-capture/components/queue/SourceQueueScreen";
import { useCapturePreviewSecurity } from "@/features/device-capture/context/CapturePreviewSecurity";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import { useLocalCapturePreviews } from "@/features/device-capture/hooks/useLocalCapturePreviews";
import { sourceQueueItemRoute } from "@/features/device-capture/models/sourceRoutes";
import RelayDeviceIngress, { type SmsCapturePreview } from "@/modules/relay-device-ingress";

export default function SmsQueueScreen() {
  const router = useRouter();
  const capture = useDeviceCaptureCapabilities();
  const security = useCapturePreviewSecurity();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
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
  const items = useMemo(
    () =>
      previews.captures.map((preview) => ({
        attempts: preview.attempts,
        capturedAt: preview.capturedAt,
        id: preview.envelopeId,
        label: preview.sender ?? "Selected contact",
        searchText: `${preview.sender ?? "Selected contact"} pending`,
        status: "Pending" as const,
        summary: "Incoming SMS captured",
      })),
    [previews.captures],
  );
  const emptyMessage = capture.mode.developmentLocal
    ? "No pending SMS captures reached the local queue."
    : "Authenticated captures synchronize in the background. Readable queue previews are limited to local diagnostic mode.";

  async function deleteQueue() {
    if (capture.mode.tenantId === undefined) return;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await RelayDeviceIngress.deleteQueuedSms(capture.mode.tenantId);
      setConfirmDelete(false);
      previews.refresh();
      await capture.refresh();
    } catch {
      setDeleteError("Could not delete queued SMS.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <SourceQueueScreen
        action={
          <AppButton
            disabled={(capture.capabilities?.smsQueuedCount ?? 0) === 0}
            label="Delete queue"
            onPress={() => setConfirmDelete(true)}
            tone="destructive"
          />
        }
        detail="Encrypted SMS work waiting on this device. List rows never reveal message content."
        emptyMessage={emptyMessage}
        error={deleteError ?? security.error ?? previews.error ?? capture.error}
        items={items}
        loading={
          capture.capabilities === undefined ||
          capture.refreshing ||
          (capture.mode.developmentLocal && !security.ready)
        }
        offlineMessage="Queued captures remain encrypted on this device while offline and retry when synchronization is available."
        onBack={() => router.back()}
        onItemPress={(item) => router.push(sourceQueueItemRoute("sms", item.id))}
        onRefresh={previews.refresh}
        title="SMS queue"
      />
      <ConfirmationDialog
        confirmLabel="Delete queued SMS"
        detail="This permanently removes encrypted SMS waiting on this device. Already uploaded items are unchanged."
        loading={deleting}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void deleteQueue()}
        title="Delete queued SMS?"
        visible={confirmDelete}
      />
    </>
  );
}
