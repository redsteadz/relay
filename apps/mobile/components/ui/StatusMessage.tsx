import { StyleSheet, View } from "react-native";
import { Icon } from "react-native-paper";

import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";
import { getMessageState, type MessageTone } from "./component-state";

type StatusMessageProps = {
  children: string;
  tone?: MessageTone;
};

const toneDetails: Record<MessageTone, { icon: string; label: string }> = {
  info: { icon: "information-outline", label: "Information" },
  success: { icon: "check-circle-outline", label: "Success" },
  warning: { icon: "alert-outline", label: "Warning" },
  error: { icon: "alert-circle-outline", label: "Error" },
};

export function StatusMessage({ children, tone = "info" }: StatusMessageProps) {
  const theme = useRelayTheme();
  const state = getMessageState(tone);
  const colors = theme.relay.colors;
  const toneColors = {
    info: [colors.infoSurface, colors.onInfoSurface, colors.info],
    success: [colors.successSurface, colors.onSuccessSurface, colors.success],
    warning: [colors.warningSurface, colors.onWarningSurface, colors.warning],
    error: [colors.dangerSurface, colors.onDangerSurface, colors.danger],
  } as const;
  const [backgroundColor, color, emphasis] = toneColors[tone];
  const details = toneDetails[tone];

  return (
    <View
      accessibilityLiveRegion={state.liveRegion}
      accessibilityRole={state.accessibilityRole}
      style={[
        styles.message,
        {
          backgroundColor,
          borderColor: emphasis,
          borderLeftWidth: theme.relay.borders.emphasis,
          borderRadius: theme.relay.radii.sm,
          gap: theme.relay.spacing.sm,
          padding: theme.relay.spacing.md,
        },
      ]}
    >
      <View
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.mark,
          {
            height: theme.relay.sizes.statusMark,
            width: theme.relay.sizes.statusMark,
          },
        ]}
      >
        <Icon color={emphasis} size={theme.relay.sizes.icon.md} source={details.icon} />
      </View>
      <View style={[styles.copy, { gap: theme.relay.spacing.xxs }]}>
        <AppText style={{ color }} variant="caption">
          {details.label}
        </AppText>
        <AppText style={{ color }}>{children}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  copy: { flex: 1 },
  mark: { alignItems: "center", justifyContent: "center" },
  message: { alignItems: "flex-start", flexDirection: "row" },
});
