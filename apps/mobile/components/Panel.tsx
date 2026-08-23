import type { PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";

import { palette } from "./Page";

type PanelProps = PropsWithChildren<{ title: string; meta?: string }>;

export function Panel({ children, meta, title }: PanelProps) {
  return (
    <View style={styles.panel}>
      <View style={styles.heading}>
        <Text style={styles.title}>{title}</Text>
        {meta === undefined ? null : <Text style={styles.meta}>{meta}</Text>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 14,
    padding: 16,
  },
  heading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  title: { color: palette.text, fontSize: 17, fontWeight: "700" },
  meta: { color: palette.muted, fontSize: 12, fontWeight: "600" },
});
