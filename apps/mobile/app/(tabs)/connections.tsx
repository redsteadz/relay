import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text } from "react-native";

import { NotificationCapturePanel } from "@/components/NotificationCapturePanel";
import { Page, palette } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { useAuth } from "@/lib/auth-context";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

export default function ConnectionsScreen() {
  const { session } = useAuth();
  const [capabilities, setCapabilities] = useState<DeviceCapabilities>();

  useEffect(() => {
    const refresh = () => RelayDeviceIngress.getCapabilities().then(setCapabilities);
    void refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => subscription.remove();
  }, []);

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
        onChanged={async () => setCapabilities(await RelayDeviceIngress.getCapabilities())}
        tenantId={session?.user.id}
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
