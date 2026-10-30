import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton, AppText, RelayMark } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { SignalIllustration } from "./SignalIllustration";

/**
 * The one screen before setup.
 *
 * It used to be three screens of prose. The picture carries what the prose was explaining, so a
 * single heading and one sentence are enough to say what Relay is before it asks for anything.
 */
export function WelcomeStep({ onStart }: { onStart: () => void }) {
  const theme = useRelayTheme();
  const { colors, layout, sizes, spacing } = theme.relay;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.frame,
          { gap: spacing.xl, padding: layout.compactGutter, paddingBottom: spacing.xl },
        ]}
      >
        <RelayMark size={sizes.icon.lg + spacing.md} />

        <View style={styles.stage}>
          <SignalIllustration />
        </View>

        <View style={{ gap: spacing.md }}>
          <AppText accessibilityRole="header" variant="hero">
            {"Many signals in.\nOne out."}
          </AppText>
          <AppText tone="muted">
            Relay sorts what your phone receives and keeps only what matters.
          </AppText>
        </View>

        <AppButton label="Get started" onPress={onStart} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, width: "100%" },
  safeArea: { flex: 1 },
  stage: { flexGrow: 1, justifyContent: "center", width: "100%" },
});
