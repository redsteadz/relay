import { StyleSheet, View } from "react-native";
import { Chip } from "react-native-paper";

import { AppText, EditorialSurface } from "@/components/ui";
import { formatPrivacyDate } from "@/features/privacy/models/privacyPresentation";
import { useRelayTheme } from "@/theme";

import type { ActivityEntry } from "../models/activityPresentation";

/**
 * One timeline row.
 *
 * A disclosure names field names, the model, and the provider, and never a value. That is the whole
 * privacy contract of this screen: the record exists to say what class of thing was sent, so
 * rendering any part of the content it describes would defeat it.
 */
export function ActivityEntryCard({ entry }: { entry: ActivityEntry }) {
  const theme = useRelayTheme();

  if (entry.kind === "disclosure") {
    return (
      <EditorialSurface
        icon={entry.icon}
        meta={formatPrivacyDate(entry.occurredAt)}
        title={entry.title}
      >
        <AppText tone="muted">
          {entry.provider} · {entry.model}
        </AppText>
        {entry.fields.length === 0 ? (
          // An empty field list is a record that nothing was sent. Rendering only the caption would
          // read as a disclosure with its detail missing, which is the opposite of what happened.
          <AppText tone="muted">No fields were sent. The clause was left undecided.</AppText>
        ) : (
          <>
            <View style={[styles.fields, { gap: theme.relay.spacing.sm }]}>
              {entry.fields.map((field) => (
                <Chip compact key={field}>
                  {field}
                </Chip>
              ))}
            </View>
            <AppText tone="muted" variant="caption">
              Field names and purpose only. The prompt and the source content are never recorded.
            </AppText>
          </>
        )}
      </EditorialSurface>
    );
  }

  // Status belongs in `meta`, not `titleAccessory`. The title row is a flex row whose title has
  // `flexShrink: 1` against an unshrinkable chip, so a status as long as "Awaiting your approval"
  // squeezes the title to zero width and wraps the header into a tall empty block.
  return (
    <EditorialSurface
      icon={entry.icon}
      meta={`${entry.statusLabel} · ${formatPrivacyDate(entry.occurredAt)}`}
      title={entry.title}
    >
      <AppText tone="muted">{entry.detail}</AppText>
      {entry.problem === undefined ? null : (
        <AppText tone="muted" variant="caption">
          {entry.problem}
        </AppText>
      )}
      {entry.decidedAt === undefined ? null : (
        <AppText tone="muted" variant="caption">
          Resolved {formatPrivacyDate(entry.decidedAt)}.
        </AppText>
      )}
    </EditorialSurface>
  );
}

const styles = StyleSheet.create({
  fields: { flexDirection: "row", flexWrap: "wrap" },
});
