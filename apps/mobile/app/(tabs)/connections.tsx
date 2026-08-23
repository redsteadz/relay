import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { Page, palette } from "@/components/Page";
import { Panel } from "@/components/Panel";
import RelayDeviceIngress, { type DeviceCapabilities } from "@/modules/relay-device-ingress";

export default function ConnectionsScreen() {
  const [capabilities, setCapabilities] = useState<DeviceCapabilities>();

  useEffect(() => {
    void RelayDeviceIngress.getCapabilities().then(setCapabilities);
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
      <Panel
        title="Android notifications"
        meta={capabilities?.notificationListener ? "AVAILABLE" : "UNAVAILABLE"}
      >
        <Text style={styles.copy}>
          Listener access is system-managed. Dismissal remains disabled until an explicit rule
          passes dry run.
        </Text>
        <Pressable
          onPress={() => void RelayDeviceIngress.openNotificationAccessSettings()}
          style={styles.outlineButton}
        >
          <Text style={styles.outlineText}>Open access settings</Text>
        </Pressable>
      </Panel>
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
  outlineButton: {
    alignSelf: "flex-start",
    borderColor: palette.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 10,
  },
  outlineText: { color: palette.text, fontSize: 13, fontWeight: "700" },
});
