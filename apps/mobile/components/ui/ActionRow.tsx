import type { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { useRelayTheme } from "@/theme";

export function ActionRow({ children }: PropsWithChildren) {
  const theme = useRelayTheme();
  return <View style={[styles.row, { gap: theme.relay.spacing.sm }]}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { alignItems: "center", flexDirection: "row", flexWrap: "wrap" },
});
