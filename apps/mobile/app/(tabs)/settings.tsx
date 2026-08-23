import { StyleSheet, Text } from "react-native";

import { Page, palette } from "@/components/Page";
import { Panel } from "@/components/Panel";

export default function SettingsScreen() {
  return (
    <Page
      eyebrow="Local control"
      title="Settings"
      detail="Retention, AI disclosure, and irreversible actions stay visible and conservative."
    >
      <Panel title="Raw data retention" meta="7 DAYS">
        <Text style={styles.copy}>
          Encrypted source payloads expire automatically. Derived facts retain provenance without
          full bodies.
        </Text>
      </Panel>
      <Panel title="OpenAI key" meta="NOT CONFIGURED">
        <Text style={styles.copy}>
          Bring-your-own key is encrypted server-side. Relay only invokes it after deterministic
          filters cannot decide.
        </Text>
      </Panel>
      <Panel title="Automatic dismissal" meta="OFF">
        <Text style={styles.copy}>
          Requires explicit source and filter rules plus dry-run evidence. Dismissed system
          notifications cannot be restored.
        </Text>
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({ copy: { color: palette.muted, fontSize: 14, lineHeight: 21 } });
