import type { FilterPlan } from "@relay/contracts";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Chip } from "react-native-paper";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import {
  decisionLabel,
  filterFieldLabel,
  previewFilterOutcomes,
  type PreviewItem,
} from "../models/filterPresentation";

type FilterPreviewPanelProps = {
  items: readonly PreviewItem[];
  plan: FilterPlan;
};

/**
 * How the rule would decide, and exactly what a model would be shown.
 *
 * Nothing here creates an action or contacts a provider: the evaluator is pure and answers
 * `undecided` for a semantic clause instead of resolving it. The disclosure beneath an undecided
 * item is produced by the same minimization the pipeline runs, so what is displayed is the payload
 * that would actually be sent — already redacted — rather than a description of one.
 */
export function FilterPreviewPanel({ items, plan }: FilterPreviewPanelProps) {
  const theme = useRelayTheme();
  const outcomes = useMemo(() => previewFilterOutcomes(plan, items), [items, plan]);

  return (
    <View style={{ gap: theme.relay.spacing.md }}>
      <AppText tone="muted" variant="caption">
        Preview only. Relay evaluates these on the device, creates no action, and sends nothing to a
        model.
      </AppText>
      {outcomes.map((outcome) => (
        <View key={outcome.id} style={{ gap: theme.relay.spacing.sm }}>
          <View style={[styles.heading, { gap: theme.relay.spacing.sm }]}>
            <AppText style={styles.label}>{outcome.label}</AppText>
            <Chip compact>{decisionLabel(outcome.decision)}</Chip>
          </View>
          {outcome.matchedFields.length === 0 ? null : (
            <AppText tone="muted" variant="caption">
              Matched on {outcome.matchedFields.map(filterFieldLabel).join(", ")}.
            </AppText>
          )}
          {outcome.disclosure === undefined ? null : (
            <View style={{ gap: theme.relay.spacing.sm }}>
              <AppText tone="muted" variant="caption">
                If you resolve this with a model, exactly this would be sent:
              </AppText>
              {outcome.disclosure.fields.map((field) => (
                <AppText key={field.field} tone="muted" variant="caption">
                  {filterFieldLabel(field.field)}: {field.value}
                  {field.truncated ? " …(cut)" : ""}
                </AppText>
              ))}
              {outcome.disclosure.redactions.length === 0 ? (
                <AppText tone="muted" variant="caption">
                  Nothing needed redacting in this item.
                </AppText>
              ) : (
                <AppText tone="muted" variant="caption">
                  Removed first:{" "}
                  {outcome.disclosure.redactions
                    .map(
                      (redaction) =>
                        `${redaction.count.toString()} ${redaction.kind.replaceAll("-", " ")} from ${filterFieldLabel(redaction.field).toLowerCase()}`,
                    )
                    .join("; ")}
                  .
                </AppText>
              )}
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { alignItems: "center", flexDirection: "row", flexWrap: "wrap" },
  label: { flexShrink: 1 },
});
