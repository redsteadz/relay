import { useRouter } from "expo-router";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { ContextualNotice, StatusMessage } from "@/components/ui";
import { SourceSummaryRow } from "@/features/device-capture/components/source/SourceSummaryRow";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import {
  gmailStatus,
  notificationStatus,
  smsStatus,
} from "@/features/device-capture/models/capturePresentation";
import { sourceCatalog, type SourceId } from "@/features/device-capture/models/sourceCatalog";
import {
  sourceConfigurationRoute,
  sourceConfigurationRoutes,
} from "@/features/device-capture/models/sourceRoutes";

/**
 * Every source, one row each.
 *
 * A row is a single target that opens its source. The privacy notice lives on each source's own
 * screen, behind the same information button, so it is read where the source is turned on rather
 * than competing with that tap here -- and a button nested in a button was invalid on web.
 */
export default function ConnectionsScreen() {
  const router = useRouter();
  const { capabilities, error } = useDeviceCaptureCapabilities();
  const statuses = {
    gmail: gmailStatus,
    notifications: notificationStatus(capabilities),
    sms: smsStatus(capabilities),
  };

  return (
    <ReceiptScreen title="Sources">
      <ContextualNotice accessibilityLabel="What a source can do">
        Tap a source to set it up. Each one is turned on separately, reads only what it lists, and
        can be turned off here at any time.
      </ContextualNotice>
      {error === undefined ? null : <StatusMessage tone="error">{error}</StatusMessage>}
      {(Object.keys(sourceConfigurationRoutes) as SourceId[]).map((sourceId) => (
        <SourceSummaryRow
          key={sourceId}
          onPress={() => router.push(sourceConfigurationRoute(sourceId))}
          source={sourceCatalog[sourceId]}
          status={statuses[sourceId]}
        />
      ))}
    </ReceiptScreen>
  );
}
