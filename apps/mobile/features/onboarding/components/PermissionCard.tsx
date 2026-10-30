import { StyleSheet, View } from "react-native";

import { AppButton, AppText, StatusPill, TintTile } from "@/components/ui";
import { useRelayTheme, type RelayTintName } from "@/theme";

import type { PermissionId, PermissionRow } from "../models/setupPresentation";

const TINT: Record<PermissionId, RelayTintName> = { background: "violet", notifications: "sky" };

/**
 * One permission: what it reads, and the control that grants it, side by side.
 *
 * The detail line is the disclosure, so it is never hidden behind the button or a dialog. Once
 * Android reports the permission granted, the button gives way to a confirmation rather than
 * disappearing, so the row still says what was allowed.
 */
export function PermissionCard({
  busy,
  onAllow,
  row,
}: {
  busy: boolean;
  onAllow: () => void;
  row: PermissionRow;
}) {
  const theme = useRelayTheme();
  const { borders, colors, radii, spacing } = theme.relay;
  const granted = row.state === "granted";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: granted ? colors.success : colors.borderSubtle,
          borderRadius: radii.lg,
          borderWidth: borders.hairline,
          gap: spacing.md,
          padding: spacing.md,
        },
      ]}
    >
      <TintTile icon={row.icon} label={row.title} tint={TINT[row.id]} />
      <View style={[styles.text, { gap: spacing.xxs }]}>
        <AppText variant="bodyStrong">{row.title}</AppText>
        <AppText tone={row.state === "restricted" ? "warning" : "muted"} variant="caption">
          {row.detail}
        </AppText>
      </View>
      {granted ? (
        <StatusPill label="Allowed" tone="success" />
      ) : row.state === "checking" ? (
        <StatusPill label="Checking" tone="muted" />
      ) : (
        <AppButton
          accessibilityHint={row.detail}
          accessibilityLabel={`Allow: ${row.title}`}
          disabled={busy}
          label="Allow"
          loading={busy}
          onPress={onAllow}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", flexDirection: "row", width: "100%" },
  text: { flex: 1 },
});
