import type { PropsWithChildren, ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { useRelayTheme } from "@/theme";

import { getPageLayout } from "./page-layout";
import { ScreenHeader } from "./ui";

type AppScreenProps = PropsWithChildren<{
  action?: ReactNode;
  backLabel?: string | undefined;
  detail: string;
  eyebrow?: string | undefined;
  onBack?: (() => void) | undefined;
  scroll?: boolean;
  title: string;
  titleAccessory?: ReactNode;
}>;

export function AppScreen({
  action,
  backLabel,
  children,
  detail,
  eyebrow,
  onBack,
  scroll = true,
  title,
  titleAccessory,
}: AppScreenProps) {
  const theme = useRelayTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const screenLayout = getPageLayout(width);

  const header = (
    <ScreenHeader
      {...(backLabel === undefined ? {} : { backLabel })}
      {...(onBack === undefined ? {} : { onBack })}
      action={action}
      detail={detail}
      eyebrow={eyebrow}
      title={title}
      titleAccessory={titleAccessory}
    />
  );
  const contentStyle = [
    styles.content,
    {
      gap: theme.relay.layout.sectionGap,
      maxWidth: theme.relay.sizes.contentMaxWidth,
    },
  ];

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safeArea, { backgroundColor: theme.relay.colors.background }]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        {scroll ? (
          <ScrollView
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{
              padding: screenLayout.pagePadding,
              paddingBottom: theme.relay.layout.screenBottom + insets.bottom,
            }}
            contentInsetAdjustmentBehavior="automatic"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={contentStyle}>
              {header}
              {children}
            </View>
          </ScrollView>
        ) : (
          <View
            style={[
              contentStyle,
              styles.staticContent,
              {
                padding: screenLayout.pagePadding,
                paddingBottom: screenLayout.pagePadding + insets.bottom,
              },
            ]}
          >
            {header}
            {children}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: { alignSelf: "center", width: "100%" },
  keyboard: { flex: 1 },
  safeArea: { flex: 1 },
  staticContent: { flex: 1 },
});
