import Constants from "expo-constants";
import { useCallback, useEffect, useState } from "react";
import { AppState, Platform, StyleSheet, Text } from "react-native";

import { NotificationCapturePanel } from "@/components/NotificationCapturePanel";
import { Page, palette } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { useAuth } from "@/lib/auth-context";
import { localDevelopmentAccessEnabled, notificationCaptureMode } from "@/lib/development-access";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

type ScopedCapabilities = {
  capabilities: DeviceCapabilities;
  stateKey: string;
};

export default function ConnectionsScreen() {
  const { session } = useAuth();
  const [scopedCapabilities, setScopedCapabilities] = useState<ScopedCapabilities>();
  const localDevelopmentAccess = localDevelopmentAccessEnabled(
    __DEV__,
    Constants.expoConfig?.extra?.relayBuildVariant,
  );
  const captureMode = notificationCaptureMode(
    session?.user.id,
    localDevelopmentAccess,
    Platform.OS,
  );
  const capabilities =
    scopedCapabilities?.stateKey === captureMode.stateKey
      ? scopedCapabilities.capabilities
      : undefined;

  const loadCapabilities = useCallback(async () => {
    return RelayDeviceIngress.getCapabilities();
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const nextCapabilities = await loadCapabilities();
        if (active) {
          setScopedCapabilities({
            capabilities: nextCapabilities,
            stateKey: captureMode.stateKey,
          });
        }
      } catch {
        if (active) setScopedCapabilities(undefined);
      }
    };
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, [captureMode.stateKey, loadCapabilities]);

  return (
    <Page
      eyebrow="Consent boundaries"
      title="Sources"
      detail="Every source is independently authorized, minimized, and revocable."
    >
      <Panel title="Gmail" meta="NOT CONNECTED">
        <Text style={styles.copy}>
          Restricted-scope testing flow. Google Pub/Sub delivers mailbox cursors, not message
          bodies.
        </Text>
      </Panel>
      <NotificationCapturePanel
        capabilities={capabilities}
        developmentLocal={captureMode.developmentLocal}
        key={captureMode.stateKey}
        onChanged={async () => {
          const nextCapabilities = await loadCapabilities();
          setScopedCapabilities({
            capabilities: nextCapabilities,
            stateKey: captureMode.stateKey,
          });
        }}
        tenantId={captureMode.tenantId}
      />
      <Panel title="SMS" meta={capabilities?.smsRead ? "PERMITTED" : "SIDELOAD ONLY"}>
        <Text style={styles.copy}>
          Sensitive permission path is isolated to internal APK distribution for initial testing.
        </Text>
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({
  copy: { color: palette.muted, fontSize: 14, lineHeight: 21 },
});
