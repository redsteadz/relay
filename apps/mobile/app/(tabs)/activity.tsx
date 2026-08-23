import { StyleSheet, Text } from "react-native";

import { Page, palette } from "@/components/Page";
import { Panel } from "@/components/Panel";

export default function ActivityScreen() {
  return (
    <Page
      eyebrow="Explain every decision"
      title="Activity"
      detail="Provenance, approvals, retries, and disclosures share one immutable timeline."
    >
      <Panel title="Action proposed" meta="12:41">
        <Text style={styles.copy}>
          Google Tasks · Create “Review North Station charge” · approval required
        </Text>
      </Panel>
      <Panel title="Semantic fallback" meta="12:41">
        <Text style={styles.copy}>
          Sent redacted merchant, amount, and subject fields. Body excluded.
        </Text>
      </Panel>
      <Panel title="Source accepted" meta="12:41">
        <Text style={styles.copy}>
          Notification identity was new; encrypted raw copy expires in seven days.
        </Text>
      </Panel>
    </Page>
  );
}

const styles = StyleSheet.create({ copy: { color: palette.muted, fontSize: 14, lineHeight: 21 } });
