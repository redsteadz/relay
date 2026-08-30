import type { GestureResponderEvent } from "react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, IconButton } from "react-native-paper";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import type { SourceStatus } from "../../models/capturePresentation";
import type { SourceDefinition } from "../../models/sourceCatalog";
import { SourceStatusLabel } from "./SourceStatusLabel";

type SourceSummaryRowProps = {
  disclosure?: boolean;
  onDisclosure?: (() => void) | undefined;
  onPress: () => void;
  source: SourceDefinition;
  status: SourceStatus;
};

export function SourceSummaryRow({
  disclosure = false,
  onDisclosure,
  onPress,
  source,
  status,
}: SourceSummaryRowProps) {
  const theme = useRelayTheme();
  const handleDisclosure = (event: GestureResponderEvent) => {
    event.stopPropagation();
    onDisclosure?.();
  };

  return (
    <Pressable
      accessibilityHint="Opens source configuration"
      accessibilityLabel={`${source.name}. ${status.label}. ${source.description}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderColor: theme.relay.colors.border,
          borderTopWidth: theme.relay.borders.emphasis,
          gap: theme.relay.spacing.md,
          minHeight: theme.relay.interaction.minimumTarget,
          opacity: pressed ? theme.relay.interaction.pressedOpacity : 1,
          paddingHorizontal: theme.relay.spacing.md,
          paddingVertical: theme.relay.spacing.lg,
        },
      ]}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.icon,
          {
            backgroundColor: theme.relay.colors.accentSubtle,
            borderRadius: theme.relay.radii.sm,
            height: theme.relay.sizes.touchTarget,
            width: theme.relay.sizes.touchTarget,
          },
        ]}
      >
        <Icon
          color={theme.relay.colors.accent}
          size={theme.relay.sizes.icon.lg}
          source={source.icon}
        />
      </View>
      <View style={[styles.copy, { gap: theme.relay.spacing.xs }]}>
        <View style={[styles.heading, { gap: theme.relay.spacing.xs }]}>
          <AppText numberOfLines={1} style={styles.name} variant="title">
            {source.name}
          </AppText>
          {!disclosure || onDisclosure === undefined ? null : (
            <IconButton
              accessibilityHint={`Shows the ${source.name} privacy notice`}
              accessibilityLabel={`About ${source.name} privacy`}
              icon="information-outline"
              iconColor={theme.relay.colors.action}
              onPress={handleDisclosure}
              size={theme.relay.sizes.icon.md}
              style={{
                height: theme.relay.sizes.touchTarget,
                margin: 0,
                width: theme.relay.sizes.touchTarget,
              }}
            />
          )}
        </View>
        <AppText numberOfLines={1} tone="muted" variant="caption">
          {source.description}
        </AppText>
        <SourceStatusLabel status={status} />
      </View>
      <View importantForAccessibility="no-hide-descendants" style={styles.chevron}>
        <Icon
          color={theme.relay.colors.textMuted}
          size={theme.relay.sizes.icon.md}
          source="chevron-right"
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chevron: { alignSelf: "center" },
  copy: { flex: 1, minWidth: 0 },
  heading: { alignItems: "center", flexDirection: "row", minHeight: 0 },
  icon: { alignItems: "center", justifyContent: "center" },
  name: { flexShrink: 1 },
  row: { alignItems: "flex-start", flexDirection: "row" },
});
