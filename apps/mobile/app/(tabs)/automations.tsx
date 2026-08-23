import { StyleSheet, Text, View } from "react-native";

import { Page, palette } from "@/components/Page";
import { Panel } from "@/components/Panel";

const rules = [
  ["Transit purchases", "Bank sources · semantic fallback allowed", "APPROVAL"],
  ["Promotional noise", "Explicit Gmail and app sender list", "QUIET"],
  ["Delivery changes", "Gmail + notifications · due-time extraction", "APPROVAL"],
];

export default function AutomationsScreen() {
  return (
    <Page
      eyebrow="Versioned filters"
      title="Rules"
      detail="Plain language becomes inspectable predicates. Ambiguity is recorded, never hidden."
    >
      {rules.map(([title, description, mode]) => (
        <Panel key={title} title={title ?? "Rule"} meta={mode}>
          <View style={styles.row}>
            <View style={styles.indicator} />
            <Text style={styles.description}>{description}</Text>
          </View>
        </Panel>
      ))}
    </Page>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", gap: 10 },
  indicator: { backgroundColor: palette.accent, borderRadius: 4, height: 8, width: 8 },
  description: { color: palette.muted, flex: 1, fontSize: 14 },
});
