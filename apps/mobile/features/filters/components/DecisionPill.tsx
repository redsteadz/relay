import { StyleSheet, View } from "react-native";
import type { FilterDecision } from "@relay/domain";

import { AppText } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { decisionLabel } from "../models/filterPresentation";

/**
 * How a rule would decide one item, as a pill.
 *
 * Three outcomes and three surfaces, because "no match" is a result rather than a failure and must
 * not be coloured like one. "Needs a model" is the warning surface: it is the only outcome of the
 * three that would cause anything to leave the account, and a dry run exists to make that visible
 * before the rule is saved.
 */
export function DecisionPill({ decision }: { decision: FilterDecision }) {
  const theme = useRelayTheme();
  const { colors, radii, spacing } = theme.relay;
  const surface =
    decision === "match"
      ? { background: colors.successSurface, foreground: colors.onSuccessSurface }
      : decision === "undecided"
        ? { background: colors.warningSurface, foreground: colors.onWarningSurface }
        : { background: colors.infoSurface, foreground: colors.onInfoSurface };

  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: surface.background,
          borderRadius: radii.xs,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xxs,
        },
      ]}
    >
      <AppText style={{ color: surface.foreground }} variant="mono">
        {decisionLabel(decision)}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { flexShrink: 0 },
});
