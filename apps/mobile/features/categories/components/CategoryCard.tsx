import type { Category } from "@relay/contracts";
import { StyleSheet, View } from "react-native";
import { Chip, Surface } from "react-native-paper";

import { AppButton, AppSwitch, AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

type CategoryCardProps = {
  category: Category;
  disableMoveDown?: boolean;
  disableMoveUp?: boolean;
  disabled: boolean;
  onArchive?: (() => void) | undefined;
  onDelete?: (() => void) | undefined;
  onEdit?: (() => void) | undefined;
  onMoveDown?: (() => void) | undefined;
  onMoveUp?: (() => void) | undefined;
  onQuietChange?: ((quiet: boolean) => void) | undefined;
  onRestore?: (() => void) | undefined;
};

export function CategoryCard({
  category,
  disableMoveDown = false,
  disableMoveUp = false,
  disabled,
  onArchive,
  onDelete,
  onEdit,
  onMoveDown,
  onMoveUp,
  onQuietChange,
  onRestore,
}: CategoryCardProps) {
  const theme = useRelayTheme();
  const archived = category.archivedAt !== undefined;
  return (
    <Surface
      elevation={theme.relay.elevation.flat}
      style={[
        {
          backgroundColor: theme.relay.colors.surfaceRaised,
          borderColor: theme.relay.colors.border,
          borderWidth: theme.relay.borders.hairline,
          borderRadius: theme.relay.radii.md,
          gap: theme.relay.spacing.md,
          padding: theme.relay.spacing.md,
        },
      ]}
    >
      <View style={[styles.heading, { gap: theme.relay.spacing.sm }]}>
        <View style={styles.copy}>
          <AppText variant="title">{category.name}</AppText>
          <AppText tone="muted" variant="caption">
            {category.slug}
          </AppText>
        </View>
        <Chip compact>{category.isSystem ? "System" : archived ? "Archived" : "Custom"}</Chip>
      </View>
      {category.description === undefined ? null : (
        <AppText tone="muted">{category.description}</AppText>
      )}
      {onQuietChange === undefined ? (
        <AppText tone="muted">
          {category.quietByDefault ? "Quiet by default" : "Normal emphasis"}
        </AppText>
      ) : (
        <AppSwitch
          disabled={disabled}
          detail="This changes emphasis only; source dismissal still requires an explicit rule."
          label="Quiet by default"
          onValueChange={onQuietChange}
          value={category.quietByDefault}
        />
      )}
      <View style={[styles.actions, { gap: theme.relay.spacing.sm }]}>
        {onMoveUp === undefined ? null : (
          <AppButton
            accessibilityLabel={`Move ${category.name} up`}
            disabled={disabled || disableMoveUp}
            label="Move up"
            onPress={onMoveUp}
            tone="secondary"
          />
        )}
        {onMoveDown === undefined ? null : (
          <AppButton
            accessibilityLabel={`Move ${category.name} down`}
            disabled={disabled || disableMoveDown}
            label="Move down"
            onPress={onMoveDown}
            tone="secondary"
          />
        )}
        {onEdit === undefined ? null : (
          <AppButton disabled={disabled} label="Edit" onPress={onEdit} tone="secondary" />
        )}
        {onArchive === undefined ? null : (
          <AppButton disabled={disabled} label="Archive" onPress={onArchive} tone="secondary" />
        )}
        {onRestore === undefined ? null : (
          <AppButton disabled={disabled} label="Restore" onPress={onRestore} tone="secondary" />
        )}
        {onDelete === undefined ? null : (
          <AppButton disabled={disabled} label="Delete" onPress={onDelete} tone="destructive" />
        )}
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", flexWrap: "wrap" },
  copy: { flex: 1 },
  heading: { alignItems: "flex-start", flexDirection: "row" },
});
