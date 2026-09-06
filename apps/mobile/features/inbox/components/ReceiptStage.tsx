import type { PropsWithChildren, ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

/**
 * One stage of a receipt: arrived, read, filed, proposed.
 *
 * The four run in the order the pipeline ran them, so reading the screen top to bottom is reading
 * what happened in sequence. Each stage is numbered rather than merely titled, because the point of
 * the sequence is that a later stage could only be reached through the earlier ones.
 */
export function ReceiptStage({
  children,
  label,
  ordinal,
  trailing,
}: PropsWithChildren<{
  label: string;
  ordinal: number;
  /** A control belonging to this stage, such as the plan disclosure on "Filed". */
  trailing?: ReactNode;
}>) {
  const theme = useRelayTheme();
  const { borders, colors, spacing } = theme.relay;
  return (
    <View style={[styles.stage, { gap: spacing.sm }]}>
      <View
        style={[
          styles.header,
          {
            borderBottomColor: colors.borderSubtle,
            borderBottomWidth: borders.hairline,
            gap: spacing.sm,
            paddingBottom: spacing.xs,
          },
        ]}
      >
        <AppText tone="muted" variant="monoMeta">
          {String(ordinal).padStart(2, "0")}
        </AppText>
        <AppText accessibilityRole="header" style={styles.label} variant="eyebrow">
          {label}
        </AppText>
        {trailing}
      </View>
      <View style={[styles.body, { gap: spacing.sm }]}>{children}</View>
    </View>
  );
}

/** One labelled line. Absent values are omitted rather than rendered as an empty row. */
export function ReceiptField({ label, value }: { label: string; value: string | undefined }) {
  const theme = useRelayTheme();
  const { spacing } = theme.relay;
  if (value === undefined || value.length === 0) return null;
  return (
    <View style={[styles.field, { gap: spacing.md }]}>
      <AppText style={styles.fieldLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      <AppText style={styles.fieldValue} variant="mono">
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { width: "100%" },
  field: { flexDirection: "row", justifyContent: "space-between", width: "100%" },
  fieldLabel: { flexShrink: 0 },
  fieldValue: { flexShrink: 1, textAlign: "right" },
  header: { alignItems: "center", flexDirection: "row", width: "100%" },
  label: { flexGrow: 1 },
  stage: { width: "100%" },
});
