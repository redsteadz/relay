import type { PropsWithChildren, ReactNode } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useRelayTheme } from "@/theme";

import { getPageLayout } from "./page-layout";
import { AppText } from "./ui";

type PageProps = PropsWithChildren<{
  eyebrow: string;
  title: string;
  detail: string;
  action?: ReactNode;
}>;

export function Page({ action, children, detail, eyebrow, title }: PageProps) {
  const theme = useRelayTheme();
  const { width } = useWindowDimensions();
  const layout = getPageLayout(width);

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safeArea, { backgroundColor: theme.relay.colors.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            gap: theme.relay.spacing.xl,
            padding: layout.pagePadding,
            paddingBottom: theme.relay.spacing.pageBottom,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={[
            styles.header,
            {
              flexDirection: layout.headerDirection,
              gap: theme.relay.spacing.lg,
            },
          ]}
        >
          <View style={[styles.copy, { gap: theme.relay.spacing.sm }]}>
            <AppText tone="accent" variant="eyebrow">
              {eyebrow.toUpperCase()}
            </AppText>
            <AppText variant="hero">{title}</AppText>
            <AppText style={styles.detail} tone="muted">
              {detail}
            </AppText>
          </View>
          {action}
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { width: "100%" },
  header: {
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  copy: { flexShrink: 1 },
  detail: { maxWidth: 560 },
});
