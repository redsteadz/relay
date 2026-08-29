import { Page } from "@/components/Page";
import { Panel } from "@/components/Panel";
import { AppText } from "@/components/ui";

export default function ActivityScreen() {
  return (
    <Page
      eyebrow="Explain every decision"
      title="Activity"
      detail="Provenance, approvals, retries, and disclosures share one immutable timeline."
    >
      <Panel title="Action proposed" meta="12:41">
        <AppText tone="muted">
          Google Tasks · Create “Review North Station charge” · approval required
        </AppText>
      </Panel>
      <Panel title="Semantic fallback" meta="12:41">
        <AppText tone="muted">
          Sent redacted merchant, amount, and subject fields. Body excluded.
        </AppText>
      </Panel>
      <Panel title="Source accepted" meta="12:41">
        <AppText tone="muted">
          Notification identity was new; encrypted raw copy expires in seven days.
        </AppText>
      </Panel>
    </Page>
  );
}
