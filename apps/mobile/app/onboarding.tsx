import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton, AppText, RelayMark } from "@/components/ui";
import { sourceCatalog, type SourceId } from "@/features/device-capture/models/sourceCatalog";
import { useOnboardingState } from "@/hooks/useOnboardingState";
import { useRelayTheme } from "@/theme";

/**
 * What each source may read, said before any of them is asked for.
 *
 * These are descriptions, not switches. Every source has its own consent screen with its own
 * Android permission behind it, and a toggle here would either be a lie -- flipping nothing -- or a
 * consent gesture collected before the disclosure that has to precede it. Naming the boundary and
 * then sending a person to the source is the honest order.
 */
const SOURCE_ORDER: readonly SourceId[] = ["gmail", "notifications", "sms"];

const STEPS = [
  {
    body: "Notifications, mail and messages arrive all day and each one asks for the same attention as the last. Relay reads what arrived, keeps the facts, and gives you back one receipt per thing that actually happened.",
    heading: "Many signals in. One out.",
    label: "What Relay is",
  },
  {
    body: "Rules you write decide first, and they read only the fields they name. A model is asked only for what those rules cannot decide, only with a key you provide, and only after you have seen the exact fields it would be sent. Nothing acts on your behalf until you approve it.",
    heading: "It shows its working.",
    label: "How it decides",
  },
  {
    body: "Each source is authorized on its own and can be revoked on its own. Nothing is captured until you turn a source on and grant it, and you can pause any of them at any time.",
    heading: "You choose what it may read.",
    label: "What it may read",
  },
] as const;

/**
 * The introduction.
 *
 * Three steps, because there are exactly three things a person has to know before deciding whether
 * to grant anything: what Relay produces, how it decides, and what it would have to read. Skipping
 * is available on every step -- an introduction that cannot be left is a wall, and the same facts
 * are on the source screens where they are actually needed.
 */
export default function OnboardingScreen() {
  const theme = useRelayTheme();
  const { colors, radii, sizes, spacing } = theme.relay;
  const onboarding = useOnboardingState();
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  // Completing flips the route guard in the root layout, which navigates away on its own. Pushing
  // a destination from here as well would race that redirect and could land somewhere the guard
  // does not allow -- sign-in, for a person who has not signed in yet.
  const finish = onboarding.complete;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.frame,
          { padding: theme.relay.layout.compactGutter, paddingBottom: spacing.xl },
        ]}
      >
        <View style={[styles.head, { gap: spacing.md }]}>
          <RelayMark size={sizes.icon.lg + spacing.md} />
          <AppText tone="muted" variant="eyebrow">
            {current.label}
          </AppText>
        </View>

        <View style={[styles.body, { gap: spacing.lg }]}>
          <AppText accessibilityRole="header" variant="hero">
            {current.heading}
          </AppText>
          <AppText tone="muted">{current.body}</AppText>

          {last ? (
            <View style={[styles.sources, { gap: spacing.sm }]}>
              {SOURCE_ORDER.map((id) => (
                <View
                  key={id}
                  style={[
                    styles.source,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.borderSubtle,
                      borderRadius: radii.md,
                      borderWidth: theme.relay.borders.hairline,
                      gap: spacing.xs,
                      padding: spacing.md,
                    },
                  ]}
                >
                  <AppText variant="bodyStrong">{sourceCatalog[id].name}</AppText>
                  <AppText tone="muted" variant="caption">
                    {sourceCatalog[id].description}
                  </AppText>
                </View>
              ))}
              <AppText tone="muted" variant="caption">
                Nothing is captured yet. You turn each of these on from Sources, one at a time.
              </AppText>
            </View>
          ) : null}
        </View>

        <View style={[styles.foot, { gap: spacing.lg }]}>
          <View
            accessibilityLabel={`Step ${String(step + 1)} of ${String(STEPS.length)}`}
            style={[styles.dots, { gap: spacing.sm }]}
          >
            {STEPS.map((entry, index) => (
              <View
                key={entry.label}
                style={{
                  backgroundColor: index === step ? colors.accent : colors.actionSubtle,
                  borderRadius: radii.pill,
                  height: spacing.sm,
                  width: index === step ? spacing.xl : spacing.sm,
                }}
              />
            ))}
          </View>

          <AppButton
            label={last ? "Open inbox" : "Continue"}
            onPress={() => {
              if (last) finish();
              else setStep(step + 1);
            }}
          />

          <Pressable accessibilityRole="button" onPress={finish} style={styles.skip}>
            <AppText tone="muted" variant="caption">
              {last ? "Set sources up later" : "Skip"}
            </AppText>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, justifyContent: "center", width: "100%" },
  dots: { alignItems: "center", flexDirection: "row", justifyContent: "center" },
  foot: { width: "100%" },
  frame: { flex: 1, width: "100%" },
  head: { alignItems: "flex-start", width: "100%" },
  safeArea: { flex: 1 },
  skip: { alignItems: "center", width: "100%" },
  source: { width: "100%" },
  sources: { width: "100%" },
});
