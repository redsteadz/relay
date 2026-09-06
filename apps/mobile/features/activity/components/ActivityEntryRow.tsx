import { StyleSheet, View } from "react-native";

import { AppText, MonoChip } from "@/components/ui";
// `time` sits in a flex row against a title that shrinks, so it has to stay short. This is the
// compact, same-day-aware formatter the inbox already uses for exactly that slot.
import { formatCaptureTime } from "@/features/inbox/models/inboxPresentation";
import { formatPrivacyDate } from "@/features/privacy/models/privacyPresentation";
import { useRelayTheme } from "@/theme";

import type { ActivityEntry } from "../models/activityPresentation";

/**
 * One timeline row.
 *
 * A dot in the entry's own colour rather than an icon in a tile: the ledger is read as a column, and
 * a coloured stem down the left edge is what makes five kinds separable at a glance without giving
 * each row the weight of a card.
 *
 * A disclosure names field names, the model, and the provider, and never a value. That is the whole
 * privacy contract of this screen: the record exists to say what class of thing was sent, so
 * rendering any part of the content it describes would defeat it.
 */
export function ActivityEntryRow({ entry }: { entry: ActivityEntry }) {
  const theme = useRelayTheme();
  const { colors, radii, spacing } = theme.relay;

  const dot = {
    action: colors.accent,
    disclosure: colors.warning,
    retention: colors.textMuted,
    rule: colors.info,
    source: colors.success,
  }[entry.kind];

  return (
    <View style={[styles.row, { gap: spacing.md }]}>
      <View
        style={[
          styles.dot,
          {
            backgroundColor: dot,
            borderRadius: radii.pill,
            height: spacing.sm,
            marginTop: spacing.xs,
            width: spacing.sm,
          },
        ]}
      />

      <View style={[styles.body, { gap: spacing.xs }]}>
        <View style={[styles.heading, { gap: spacing.sm }]}>
          <AppText style={styles.title} variant="bodyStrong">
            {entry.title}
          </AppText>
          <AppText tone="muted" variant="monoMeta">
            {formatCaptureTime(entry.occurredAt)}
          </AppText>
        </View>

        {entry.kind === "disclosure" ? (
          <>
            <AppText tone="muted" variant="caption">
              {entry.provider} · {entry.model}
            </AppText>
            {entry.fields.length === 0 ? (
              // An empty field list is a record that nothing was sent. Rendering only the caption
              // would read as a disclosure with its detail missing, which is the opposite of what
              // happened.
              <AppText tone="muted" variant="caption">
                No fields were sent. The clause was left undecided.
              </AppText>
            ) : (
              <>
                <View style={[styles.fields, { gap: spacing.xs }]}>
                  {entry.fields.map((field) => (
                    <MonoChip key={field} value={field} />
                  ))}
                </View>
                <AppText tone="muted" variant="caption">
                  Field names and purpose only. The prompt and the source content are never
                  recorded.
                </AppText>
              </>
            )}
          </>
        ) : entry.kind === "action" ? (
          <>
            <AppText tone="muted" variant="caption">
              {entry.statusLabel} · {entry.detail}
            </AppText>
            {entry.problem === undefined ? null : (
              <AppText tone="warning" variant="caption">
                {entry.problem}
              </AppText>
            )}
            {entry.decidedAt === undefined ? null : (
              <AppText tone="muted" variant="monoMeta">
                {`Resolved ${formatPrivacyDate(entry.decidedAt)}`}
              </AppText>
            )}
          </>
        ) : (
          <AppText tone="muted" variant="caption">
            {entry.detail}
          </AppText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flexShrink: 1, flexGrow: 1 },
  dot: { flexShrink: 0 },
  fields: { flexDirection: "row", flexWrap: "wrap" },
  heading: { alignItems: "baseline", flexDirection: "row" },
  row: { flexDirection: "row", width: "100%" },
  title: { flexShrink: 1, flexGrow: 1 },
});
