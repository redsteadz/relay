import { useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { IconButton, Menu } from "react-native-paper";

import { getContextualNoticeWidth } from "@/components/page-layout";
import { useRelayTheme } from "@/theme";

import { AppText } from "./AppText";

export type ContextualNoticeTone = "info" | "warning";

type ContextualNoticeProps = {
  accessibilityLabel?: string;
  children: string;
  tone?: ContextualNoticeTone;
};

const toneDetails: Record<ContextualNoticeTone, { icon: string; label: string }> = {
  info: { icon: "information-outline", label: "Information" },
  warning: { icon: "alert-outline", label: "Warning" },
};

export function ContextualNotice({
  accessibilityLabel,
  children,
  tone = "info",
}: ContextualNoticeProps) {
  const theme = useRelayTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [anchorX, setAnchorX] = useState<number>(theme.relay.layout.compactGutter);
  const colors = theme.relay.colors;
  const details = toneDetails[tone];
  const [backgroundColor, color, emphasis] =
    tone === "warning"
      ? [colors.warningSurface, colors.onWarningSurface, colors.warning]
      : [colors.infoSurface, colors.onInfoSurface, colors.info];
  const bubbleWidth = getContextualNoticeWidth(viewportWidth, anchorX);

  return (
    <Menu
      anchor={
        <View onLayout={(event) => setAnchorX(event.nativeEvent.layout.x)}>
          <IconButton
            accessibilityHint={`Shows ${details.label.toLowerCase()} in a pop-up`}
            accessibilityLabel={accessibilityLabel ?? `Show ${details.label.toLowerCase()}`}
            icon={details.icon}
            iconColor={emphasis}
            hitSlop={theme.relay.spacing.xs}
            onPress={() => setVisible(true)}
            size={theme.relay.sizes.icon.md}
            style={[
              styles.trigger,
              {
                height: theme.relay.sizes.compactTouchTarget,
                width: theme.relay.sizes.compactTouchTarget,
              },
            ]}
          />
        </View>
      }
      anchorPosition="bottom"
      style={{ width: bubbleWidth }}
      contentStyle={[
        {
          backgroundColor,
          borderColor: emphasis,
          borderRadius: theme.relay.radii.md,
          borderLeftWidth: theme.relay.borders.emphasis,
          width: bubbleWidth,
        },
      ]}
      onDismiss={() => setVisible(false)}
      visible={visible}
    >
      <View
        accessibilityLiveRegion="polite"
        accessibilityRole="alert"
        style={{ gap: theme.relay.spacing.xxs, padding: theme.relay.spacing.md }}
      >
        <AppText style={{ color }} variant="caption">
          {details.label}
        </AppText>
        <AppText style={{ color }}>{children}</AppText>
      </View>
    </Menu>
  );
}

const styles = StyleSheet.create({
  trigger: { margin: 0 },
});
