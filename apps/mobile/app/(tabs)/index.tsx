import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppButton, AppText } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { sendDemoIngress } from "@/lib/demo";
import { registerInstallation } from "@/lib/device";
import { useRelayTheme } from "@/theme";

export default function InboxScreen() {
  const { session } = useAuth();
  const theme = useRelayTheme();
  const [status, setStatus] = useState("Ready for local simulation");
  const [sending, setSending] = useState(false);

  async function simulate() {
    setSending(true);
    setStatus("Sending...");
    try {
      if (session === null) throw new Error("Authentication required");
      const device = await registerInstallation(session.user.id, session.access_token);
      const result = await sendDemoIngress(session.access_token, device.id);
      setStatus(result.accepted ? `Queued ${result.id.slice(0, 8)}` : "Not accepted");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unknown ingestion error");
    } finally {
      setSending(false);
    }
  }

  return (
    <Page
      eyebrow="Signal over noise"
      title="Inbox"
      detail="Important facts remain visible. Everything else stays searchable without demanding attention."
      action={
        <View style={styles.score}>
          <AppText tone="accent" variant="hero">
            3
          </AppText>
          <AppText tone="muted" variant="eyebrow">
            ACTIONABLE
          </AppText>
        </View>
      }
    >
      <Panel title="Card purchase approved" meta="NOW · TRANSACTION">
        <AppText variant="heading">$14.20 at North Station</AppText>
        <AppText tone="muted">
          Possible transit expense · awaiting Google Tasks action approval
        </AppText>
        <View style={styles.tags}>
          {["Example Bank", "92% confidence"].map((tag) => (
            <AppText
              key={tag}
              style={[
                styles.tag,
                {
                  backgroundColor: theme.relay.colors.surfaceRaised,
                  borderRadius: theme.relay.radii.pill,
                  paddingHorizontal: theme.relay.spacing.md,
                  paddingVertical: theme.relay.spacing.sm,
                },
              ]}
              tone="accent"
              variant="caption"
            >
              {tag}
            </AppText>
          ))}
        </View>
      </Panel>

      <Panel title="Local walking skeleton" meta="DEVELOPMENT">
        <AppText tone="muted">{status}</AppText>
        <AppButton
          label="Send simulated notification"
          loading={sending}
          onPress={() => void simulate()}
        />
      </Panel>

      <AppText style={styles.quiet} tone="muted" variant="caption">
        18 low-value notifications filed quietly today
      </AppText>
    </Page>
  );
}

const styles = StyleSheet.create({
  quiet: { textAlign: "center" },
  score: { alignItems: "flex-end", paddingTop: 5 },
  tag: { overflow: "hidden" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
