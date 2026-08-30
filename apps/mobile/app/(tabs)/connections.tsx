import { useRouter } from "expo-router";
import { useState } from "react";

import { AppScreen } from "@/components/AppScreen";
import { StatusMessage } from "@/components/ui";
import { SourceDisclosureDialog } from "@/features/device-capture/components/source/SourceDisclosureDialog";
import { SourceSummaryRow } from "@/features/device-capture/components/source/SourceSummaryRow";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import {
  gmailStatus,
  notificationStatus,
  smsStatus,
} from "@/features/device-capture/models/capturePresentation";
import {
  gmailDisclosure,
  notificationDisclosure,
  smsDisclosure,
  sourceCatalog,
  type SourceId,
} from "@/features/device-capture/models/sourceCatalog";
import {
  sourceConfigurationRoute,
  sourceConfigurationRoutes,
} from "@/features/device-capture/models/sourceRoutes";

export default function ConnectionsScreen() {
  const router = useRouter();
  const { capabilities, error, mode } = useDeviceCaptureCapabilities();
  const [disclosureSource, setDisclosureSource] = useState<SourceId>();
  const disclosures = {
    gmail: gmailDisclosure,
    notifications: notificationDisclosure(mode.developmentLocal),
    sms: smsDisclosure(mode.developmentLocal),
  };
  const statuses = {
    gmail: gmailStatus,
    notifications: notificationStatus(capabilities),
    sms: smsStatus(capabilities),
  };

  return (
    <AppScreen
      detail="Every source is independently authorized, minimized, and revocable."
      eyebrow="Consent boundaries"
      title="Sources"
    >
      {error === undefined ? null : <StatusMessage tone="error">{error}</StatusMessage>}
      {(Object.keys(sourceConfigurationRoutes) as SourceId[]).map((sourceId) => (
        <SourceSummaryRow
          disclosure
          key={sourceId}
          onDisclosure={() => setDisclosureSource(sourceId)}
          onPress={() => router.push(sourceConfigurationRoute(sourceId))}
          source={sourceCatalog[sourceId]}
          status={statuses[sourceId]}
        />
      ))}
      <SourceDisclosureDialog
        disclosure={disclosureSource === undefined ? "" : disclosures[disclosureSource]}
        onDismiss={() => setDisclosureSource(undefined)}
        sourceName={
          disclosureSource === undefined ? "Source" : sourceCatalog[disclosureSource].name
        }
        visible={disclosureSource !== undefined}
      />
    </AppScreen>
  );
}
