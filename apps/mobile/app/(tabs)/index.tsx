import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import { useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Chip } from "react-native-paper";

import { AppScreen } from "@/components/AppScreen";
import { AppButton, AppText, EditorialSurface } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import {
  localDevelopmentAccessEnabled,
  notificationCaptureTenantId,
} from "@/lib/development-access";
import { demoIngress, sendDemoIngress } from "@/lib/demo";
import { registerInstallation } from "@/lib/device";
import { logMobileError } from "@/lib/observability";
import RelayDeviceIngress from "@/modules/relay-device-ingress";
import { useRelayTheme } from "@/theme";

export default function InboxScreen() {
  const { session } = useAuth();
  const theme = useRelayTheme();
  const [status, setStatus] = useState("Ready for local simulation");
  const [sending, setSending] = useState(false);
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
    setSending(true);
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
      logMobileError("ui.demo_ingress_failed", error, {
        code: "DEMO_INGRESS_FAILED",
        integration: "relay-api",
        operation: "simulateIngress",
      });
      setStatus("Could not queue the simulated notification. Check your connection and retry.");
    } finally {
      setSending(false);
    }
  }

  return (
    <AppScreen
      eyebrow="Signal over noise"
      title="Inbox"
      detail="Important facts remain visible. Everything else stays searchable without demanding attention."
      action={
        <View style={[styles.score, { paddingTop: theme.relay.spacing.xs }]}>
          <AppText tone="accent" variant="hero">
            3
          </AppText>
          <AppText tone="muted" variant="eyebrow">
            ACTIONABLE
          </AppText>
        </View>
      }
    >
      <EditorialSurface
        icon="credit-card-check-outline"
        title="Card purchase approved"
        meta="Now · Transaction"
        variant="accent"
      >
        <AppText variant="heading">$14.20 at North Station</AppText>
        <AppText tone="muted">
          Possible transit expense · awaiting Google Tasks action approval
        </AppText>
        <View style={[styles.tags, { gap: theme.relay.spacing.sm }]}>
          {["Example Bank", "92% confidence"].map((tag) => (
            <Chip compact key={tag} textStyle={theme.relay.typography.caption}>
              {tag}
            </Chip>
          ))}
        </View>
      </EditorialSurface>

      <EditorialSurface icon="flask-outline" title="Local walking skeleton" meta="Development">
        <AppText tone="muted">{status}</AppText>
        <AppButton
          label="Send simulated notification"
          loading={sending}
          onPress={() => void simulate()}
        />
      </EditorialSurface>

      <AppText style={styles.quiet} tone="muted" variant="caption">
        18 low-value notifications filed quietly today
      </AppText>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  quiet: { textAlign: "center" },
  score: { alignItems: "flex-end" },
  tags: { flexDirection: "row", flexWrap: "wrap" },
});
