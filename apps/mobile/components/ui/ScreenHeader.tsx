import type { ReactNode } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

import { getPageLayout } from "@/components/page-layout";
import { useAppMotion } from "@/hooks/useAppMotion";
import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";
import { AppIconButton } from "./AppIconButton";

type ScreenHeaderProps = {
  action?: ReactNode;
  backLabel?: string | undefined;
  detail: string;
  eyebrow?: string | undefined;
  onBack?: (() => void) | undefined;
  title: string;
  titleAccessory?: ReactNode;
};

export function ScreenHeader({
  action,
  backLabel = "Go back",
  detail,
  eyebrow,
  onBack,
  title,
  titleAccessory,
}: ScreenHeaderProps) {
  const theme = useRelayTheme();
  const { duration, reducedMotion } = useAppMotion();
  const { width } = useWindowDimensions();
  const layout = getPageLayout(width);
  const entering = reducedMotion
    ? undefined
    : FadeInDown.duration(duration(theme.relay.motion.duration.emphasis)).reduceMotion(
        ReduceMotion.System,
      );

  return (
    <Animated.View
      {...(entering === undefined ? {} : { entering })}
      style={{ gap: theme.relay.spacing.lg }}
    >
      {onBack === undefined ? null : (
        <AppIconButton
          accessibilityLabel={backLabel}
          icon="arrow-left"
          onPress={onBack}
          variant="back"
        />
      )}
      <View
        style={[
          styles.header,
          { flexDirection: layout.headerDirection, gap: theme.relay.spacing.lg },
        ]}
      >
        <View
          style={[
            styles.copy,
            layout.headerDirection === "column" ? styles.narrowCopy : styles.wideCopy,
            { gap: theme.relay.spacing.sm },
          ]}
        >
          {eyebrow === undefined ? null : (
            <AppText tone="accent" variant="eyebrow">
              {eyebrow.toUpperCase()}
            </AppText>
          )}
          <View style={[styles.titleRow, { gap: theme.relay.spacing.xxs }]}>
            <AppText accessibilityRole="header" style={styles.title} variant="hero">
              {title}
            </AppText>
            {titleAccessory === undefined ? null : (
              <View style={{ marginLeft: -theme.relay.spacing.xs }}>{titleAccessory}</View>
            )}
          </View>
          <AppText style={{ maxWidth: theme.relay.sizes.readingWidth }} tone="muted">
            {detail}
          </AppText>
        </View>
        {action}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  copy: { flexShrink: 1, minWidth: 0 },
  header: { alignItems: "flex-start", justifyContent: "space-between" },
  narrowCopy: { width: "100%" },
  title: { flexGrow: 1, flexShrink: 1, minWidth: 0 },
  titleRow: {
    alignItems: "center",
    alignSelf: "stretch",
    flexDirection: "row",
    maxWidth: "100%",
  },
  wideCopy: { flex: 1 },
});
