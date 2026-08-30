import { AppScreen } from "@/components/AppScreen";
import { AppText, EditorialSurface } from "@/components/ui";

const rules = [
  ["Transit purchases", "Bank sources · semantic fallback allowed", "APPROVAL"],
  ["Promotional noise", "Explicit Gmail and app sender list", "QUIET"],
  ["Delivery changes", "Gmail + notifications · due-time extraction", "APPROVAL"],
];

export default function AutomationsScreen() {
  return (
    <AppScreen
      eyebrow="Versioned filters"
      title="Rules"
      detail="Plain language becomes inspectable predicates. Ambiguity is recorded, never hidden."
    >
      {rules.map(([title, description, mode]) => (
        <EditorialSurface key={title} icon="tune-variant" title={title ?? "Rule"} meta={mode}>
          <AppText tone="muted">{description}</AppText>
        </EditorialSurface>
      ))}
    </AppScreen>
  );
}
