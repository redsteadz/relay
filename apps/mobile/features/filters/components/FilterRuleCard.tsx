import type { FilterRuleVersion } from "@relay/contracts";
import { View } from "react-native";

import { ActionRow, AppButton, AppText, EditorialSurface } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { filterPlanSummary } from "../models/filterPresentation";

type FilterRuleCardProps = {
  disabled: boolean;
  history: readonly FilterRuleVersion[];
  onEdit: () => void;
  onToggleEnabled: () => void;
  revision: FilterRuleVersion;
};

export function FilterRuleCard({
  disabled,
  history,
  onEdit,
  onToggleEnabled,
  revision,
}: FilterRuleCardProps) {
  const theme = useRelayTheme();
  const priorVersions = history.filter((entry) => entry.version !== revision.version);

  return (
    <EditorialSurface
      icon="tune-variant"
      meta={`v${revision.version.toString()}${revision.enabled ? "" : " · disabled"}`}
      title={revision.name}
      variant="raised"
    >
      <AppText tone="muted">{revision.intent}</AppText>
      <AppText tone="muted" variant="caption">
        {filterPlanSummary(revision.plan)}
      </AppText>
      {priorVersions.length === 0 ? null : (
        <View style={{ gap: theme.relay.spacing.sm }}>
          <AppText tone="muted" variant="caption">
            Earlier versions kept:{" "}
            {priorVersions.map((entry) => `v${entry.version.toString()}`).join(", ")}
          </AppText>
        </View>
      )}
      <ActionRow>
        <AppButton disabled={disabled} label="Edit" onPress={onEdit} tone="secondary" />
        <AppButton
          disabled={disabled}
          label={revision.enabled ? "Disable" : "Enable"}
          onPress={onToggleEnabled}
          tone={revision.enabled ? "destructive" : "secondary"}
        />
      </ActionRow>
    </EditorialSurface>
  );
}
