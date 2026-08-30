import Constants from "expo-constants";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { NotificationCapturePanel } from "@/components/NotificationCapturePanel";
import { SmsCapturePanel } from "@/components/SmsCapturePanel";
import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppText } from "@/components/ui";
import { useSecureLocalCaptureScreen } from "@/hooks/useLocalCapturePreviews";
import { useAuth } from "@/lib/auth-context";
import { localDevelopmentAccessEnabled, notificationCaptureMode } from "@/lib/development-access";
import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

type ScopedCapabilities = {
  capabilities: DeviceCapabilities;
  stateKey: string;
};

export default function ConnectionsScreen() {
  const { session } = useAuth();
  const [scopedCapabilities, setScopedCapabilities] = useState<ScopedCapabilities>();
  const capabilityRequestRef = useRef(0);
  const localDevelopmentAccess = localDevelopmentAccessEnabled(
    __DEV__,
    Constants.expoConfig?.extra?.relayBuildVariant,
  );
  const captureMode = notificationCaptureMode(
    session?.user.id,
    localDevelopmentAccess,
    Platform.OS,
  );
  const localPreview = useSecureLocalCaptureScreen(captureMode.developmentLocal);
  const capabilities =
    scopedCapabilities?.stateKey === captureMode.stateKey
      ? scopedCapabilities.capabilities
      : undefined;

  const refreshCapabilities = useCallback(async () => {
    const request = ++capabilityRequestRef.current;
    try {
      const nextCapabilities = await RelayDeviceIngress.getCapabilities();
      if (request === capabilityRequestRef.current) {
        setScopedCapabilities({ capabilities: nextCapabilities, stateKey: captureMode.stateKey });
      }
    } catch (error) {
      if (request === capabilityRequestRef.current) setScopedCapabilities(undefined);
      logMobileError("capture.capabilities_refresh_failed", error, {
        code: "CAPTURE_CAPABILITIES_REFRESH_FAILED",
        integration: "relay-device-ingress",
        operation: "getCapabilities",
      });
      throw error;
    }
  }, [captureMode.stateKey]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        if (active) await refreshCapabilities();
      } catch {
        // refreshCapabilities already logs once and clears only the latest failed request.
      }
    };
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      active = false;
      capabilityRequestRef.current += 1;
      subscription.remove();
    };
  }, [captureMode.stateKey, refreshCapabilities]);

  return (
    <Page
      eyebrow="Consent boundaries"
      title="Sources"
      detail="Every source is independently authorized, minimized, and revocable."
    >
      <Panel title="Gmail" meta="NOT CONNECTED">
        <AppText tone="muted">
          Restricted-scope testing flow. Google Pub/Sub delivers mailbox cursors, not message
          bodies.
        </AppText>
      </Panel>
      <NotificationCapturePanel
        capabilities={capabilities}
        developmentLocal={captureMode.developmentLocal}
        key={captureMode.stateKey}
        localPreviewEnabled={localPreview.ready}
        localPreviewError={localPreview.error}
        onChanged={refreshCapabilities}
        tenantId={captureMode.tenantId}
      />
      <SmsCapturePanel
        capabilities={capabilities}
        developmentLocal={captureMode.developmentLocal}
        localPreviewEnabled={localPreview.ready}
        localPreviewError={localPreview.error}
        onChanged={refreshCapabilities}
        tenantId={captureMode.tenantId}
      />
    </Page>
  );
}
