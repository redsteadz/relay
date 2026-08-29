import { StyleSheet, View } from "react-native";

import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

const rules = [
  ["Transit purchases", "Bank sources · semantic fallback allowed", "APPROVAL"],
  ["Promotional noise", "Explicit Gmail and app sender list", "QUIET"],
  ["Delivery changes", "Gmail + notifications · due-time extraction", "APPROVAL"],
];

export default function AutomationsScreen() {
  const theme = useRelayTheme();
  return (
    <Page
      eyebrow="Versioned filters"
      title="Rules"
      detail="Plain language becomes inspectable predicates. Ambiguity is recorded, never hidden."
    >
      {rules.map(([title, description, mode]) => (
        <Panel key={title} title={title ?? "Rule"} meta={mode}>
          <View style={styles.row}>
            <View style={[styles.indicator, { backgroundColor: theme.relay.colors.accent }]} />
            <AppText style={styles.description} tone="muted">
              {description}
            </AppText>
          </View>
        </Panel>
      ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  description: { flex: 1 },
  indicator: { borderRadius: 4, height: 8, width: 8 },
  row: { alignItems: "center", flexDirection: "row", gap: 10 },
});
