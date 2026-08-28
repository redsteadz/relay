import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { Page, palette } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { useAuth } from "@/lib/auth-context";
import {
  localDevelopmentAccessEnabled,
  notificationCaptureTenantId,
} from "@/lib/development-access";
import { demoIngress, sendDemoIngress } from "@/lib/demo";
import { registerInstallation } from "@/lib/device";
import RelayDeviceIngress from "@/modules/relay-device-ingress";

export default function InboxScreen() {
  const { session } = useAuth();
  const [status, setStatus] = useState("Ready for local simulation");
  const localDevelopmentAccess = localDevelopmentAccessEnabled(
    __DEV__,
    Constants.expoConfig?.extra?.relayBuildVariant,
  );
  const localCaptureTenantId = notificationCaptureTenantId(
    undefined,
    localDevelopmentAccess,
    Platform.OS,
  );

  async function simulate() {
    setStatus("Sending...");
    try {
      if (session === null) {
        if (localCaptureTenantId === undefined) throw new Error("Authentication required");
        const id = Crypto.randomUUID();
        const capturedAt = new Date().toISOString();
        await RelayDeviceIngress.enqueueCapture(localCaptureTenantId, {
          ...demoIngress,
          id,
          occurredAt: capturedAt,
          capturedAt,
          source: { ...demoIngress.source, externalId: `local-development-${id}` },
        });
        setStatus(`Stored locally ${id.slice(0, 8)}`);
        return;
      }
      const device = await registerInstallation(session.user.id, session.access_token);
      const result = await sendDemoIngress(session.access_token, device.id);
      setStatus(result.accepted ? `Queued ${result.id.slice(0, 8)}` : "Not accepted");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unknown ingestion error");
    }
  }

  return (
    <Page
      eyebrow="Signal over noise"
      title="Inbox"
      detail="Important facts remain visible. Everything else stays searchable without demanding attention."
      action={
        <View style={styles.score}>
          <Text style={styles.scoreValue}>3</Text>
          <Text style={styles.scoreLabel}>ACTIONABLE</Text>
        </View>
      }
    >
      <Panel title="Card purchase approved" meta="NOW · TRANSACTION">
        <Text style={styles.primary}>$14.20 at North Station</Text>
        <Text style={styles.secondary}>
          Possible transit expense · awaiting Google Tasks action approval
        </Text>
        <View style={styles.tags}>
          <Text style={styles.tag}>Example Bank</Text>
          <Text style={styles.tag}>92% confidence</Text>
        </View>
      </Panel>

      <Panel title="Local walking skeleton" meta="DEVELOPMENT">
        <Text style={styles.secondary}>{status}</Text>
        <Pressable accessibilityRole="button" onPress={() => void simulate()} style={styles.button}>
          <Text style={styles.buttonText}>Send simulated notification</Text>
        </Pressable>
      </Panel>

      <Text style={styles.quiet}>18 low-value notifications filed quietly today</Text>
    </Page>
  );
}

const styles = StyleSheet.create({
  score: { alignItems: "flex-end", paddingTop: 5 },
  scoreValue: { color: palette.accent, fontSize: 31, fontWeight: "800" },
  scoreLabel: { color: palette.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.2 },
  primary: { color: palette.text, fontSize: 21, fontWeight: "700" },
  secondary: { color: palette.muted, fontSize: 14, lineHeight: 21 },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tag: {
    backgroundColor: palette.panelStrong,
    borderRadius: 999,
    color: palette.accent,
    fontSize: 12,
    overflow: "hidden",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  button: {
    alignSelf: "flex-start",
    backgroundColor: palette.accent,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  buttonText: { color: palette.background, fontSize: 13, fontWeight: "800" },
  quiet: { color: palette.muted, fontSize: 13, textAlign: "center" },
});
