import { View } from "react-native";
import { SegmentedButtons } from "react-native-paper";

import { AppTextInput } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import type { QueueTimeFilter } from "../../models/queuePresentation";

type QueueFilterBarProps = {
  filter: QueueTimeFilter;
  onFilterChange: (filter: QueueTimeFilter) => void;
  onQueryChange: (query: string) => void;
  query: string;
};

export function QueueFilterBar({
  filter,
  onFilterChange,
  onQueryChange,
  query,
}: QueueFilterBarProps) {
  const theme = useRelayTheme();
  return (
    <View style={{ gap: theme.relay.spacing.sm }}>
      <AppTextInput
        accessibilityLabel="Search queue"
        autoCapitalize="none"
        autoCorrect={false}
        label="Search queue"
        onChangeText={onQueryChange}
        value={query}
      />
      <SegmentedButtons
        buttons={[
          { label: "All", value: "all" },
          { label: "1 hour", value: "hour" },
          { label: "Today", value: "today" },
        ]}
        density="small"
        onValueChange={onFilterChange}
        value={filter}
      />
    </View>
  );
}
