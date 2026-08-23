import type { PropsWithChildren, ReactNode } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";

type PageProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
  detail: string;
  action?: ReactNode;
}>;

export function Page({ action, children, detail, eyebrow, title }: PageProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>{eyebrow}</Text>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.detail}>{detail}</Text>
          </View>
          {action}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export const palette = {
  background: "#111713",
  panel: "#18201b",
  panelStrong: "#202b24",
  border: "#304037",
  text: "#edf5ef",
  muted: "#93a198",
  accent: "#b9f6cf",
  amber: "#ffd08a",
};

const styles = StyleSheet.create({
  safeArea: { backgroundColor: palette.background, flex: 1 },
  content: { gap: 18, padding: 20, paddingBottom: 48 },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
  },
  copy: { flex: 1, gap: 7 },
  eyebrow: {
    color: palette.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  title: { color: palette.text, fontSize: 34, fontWeight: "700", letterSpacing: -1.3 },
  detail: { color: palette.muted, fontSize: 15, lineHeight: 22, maxWidth: 560 },
});
