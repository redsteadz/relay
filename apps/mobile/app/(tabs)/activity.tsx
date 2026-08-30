import { AppScreen } from "@/components/AppScreen";
import { AppText, EditorialSurface } from "@/components/ui";

export default function ActivityScreen() {
  return (
    <AppScreen
      eyebrow="Explain every decision"
      title="Activity"
      detail="Provenance, approvals, retries, and disclosures share one immutable timeline."
    >
      <EditorialSurface icon="gesture-tap-button" title="Action proposed" meta="12:41">
        <AppText tone="muted">
          Google Tasks · Create “Review North Station charge” · approval required
        </AppText>
      </EditorialSurface>
      <EditorialSurface icon="brain" title="Semantic fallback" meta="12:41">
        <AppText tone="muted">
          Sent redacted merchant, amount, and subject fields. Body excluded.
        </AppText>
      </EditorialSurface>
      <EditorialSurface icon="shield-check-outline" title="Source accepted" meta="12:41">
        <AppText tone="muted">
          Notification identity was new; encrypted raw copy expires in seven days.
        </AppText>
      </EditorialSurface>
    </AppScreen>
  );
}
