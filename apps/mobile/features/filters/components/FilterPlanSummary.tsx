import type { FilterCompilation } from "@relay/contracts";
import { StyleSheet, View } from "react-native";
import { Chip } from "react-native-paper";

import { AppText, StatusMessage } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import {
  describeFilterExpression,
  explainUnsupportedClauses,
  filterFieldLabel,
} from "../models/filterPresentation";

type FilterPlanSummaryProps = {
  compilation: FilterCompilation;
};

/**
 * The compiled behaviour of an intent, shown before it is saved.
 *
 * Everything a rule can do is named here: the predicates that decide it, the clause that would go
 * to a model, the fields that clause is allowed to read, the confidence Relay demands, and the
 * clauses the compiler could not turn into either. A rule that will match nothing says so.
 */
export function FilterPlanSummary({ compilation }: FilterPlanSummaryProps) {
  const theme = useRelayTheme();
  const { plan, unsupportedClauses } = compilation;
  const lines = describeFilterExpression(plan.deterministic);
  const unsupported = explainUnsupportedClauses(unsupportedClauses);

  return (
    <View style={{ gap: theme.relay.spacing.md }}>
      <View style={{ gap: theme.relay.spacing.sm }}>
        <AppText variant="label">Deterministic checks</AppText>
        {lines.length === 0 ? (
          <AppText tone="muted" variant="caption">
            None. This rule is decided entirely by the semantic clause below.
          </AppText>
        ) : (
          lines.map((line, index) => (
            <AppText
              key={`${index.toString()}-${line.text}`}
              style={{ paddingLeft: line.depth * theme.relay.spacing.md }}
              tone={line.kind === "group" ? "muted" : "default"}
              variant={line.kind === "group" ? "caption" : "body"}
            >
              {line.text}
            </AppText>
          ))
        )}
        <AppText tone="muted" variant="caption">
          These run first, on the device runtime, and never contact a provider.
        </AppText>
      </View>

      <View style={{ gap: theme.relay.spacing.sm }}>
        <AppText variant="label">Semantic clause</AppText>
        {plan.semantic === undefined ? (
          <AppText tone="muted" variant="caption">
            None. This rule never sends anything to a model.
          </AppText>
        ) : (
          <>
            <AppText>{plan.semantic.question}</AppText>
            <AppText tone="muted" variant="caption">
              Asked only when the deterministic checks cannot decide, and only if you have a key
              configured. Without one the rule stays undecided.
            </AppText>
            <AppText variant="label">Fields this clause may read</AppText>
            <View style={[styles.chips, { gap: theme.relay.spacing.sm }]}>
              {plan.semantic.allowedFields.map((field) => (
                <Chip compact key={field}>
                  {filterFieldLabel(field)}
                </Chip>
              ))}
            </View>
            <AppText tone="muted" variant="caption">
              Nothing outside this list is read, and each value is redacted and bounded before it
              leaves. Minimum confidence:{" "}
              {Math.round(plan.semantic.minimumConfidence * 100).toString()}% — a less certain
              answer stays undecided.
            </AppText>
          </>
        )}
      </View>

      {unsupported.length === 0 ? null : (
        <View style={{ gap: theme.relay.spacing.sm }}>
          <AppText variant="label">Not compiled</AppText>
          {unsupported.map((clause) => (
            <StatusMessage key={clause.text} tone="warning">
              {`"${clause.text}" — ${clause.detail}`}
            </StatusMessage>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap" },
});
