import { StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

/**
 * The tear-off line across a receipt.
 *
 * It separates what Relay observed from what Relay proposes to do about it. A solid rule reads as
 * one more section break; the perforation says the two halves are different kinds of claim, and that
 * the lower one has not happened yet.
 *
 * React Native only honours `borderStyle: "dashed"` when every border on the view has the same
 * width, so a full-width box is drawn and clipped to its own top edge by the parent.
 */
export function DashedRule() {
  const theme = useRelayTheme();
  const { borders, colors } = theme.relay;
  return (
    <View style={[styles.clip, { height: borders.hairline }]}>
      <View
        style={[
          styles.rule,
          {
            borderColor: colors.borderSubtle,
            borderWidth: borders.hairline,
            height: borders.hairline * 2,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden", width: "100%" },
  rule: { borderStyle: "dashed", width: "100%" },
});
