import { router } from "expo-router";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppButton, AppText, EmptyState, StatusMessage } from "@/components/ui";
import { DisclosureCard } from "@/features/privacy/components/DisclosureCard";
import { useDisclosureHistory } from "@/features/privacy/hooks/usePrivacySettings";
import { privacyErrorMessage } from "@/features/privacy/models/privacyPresentation";
import { useAuth } from "@/lib/auth-context";
import { useRelayTheme } from "@/theme";

export default function DisclosuresScreen() {
  const theme = useRelayTheme();
  const { session } = useAuth();
  const disclosures = useDisclosureHistory(session?.user.id, session?.access_token);

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safeArea, { backgroundColor: theme.relay.colors.background }]}
    >
      <FlatList
        ListEmptyComponent={
          session === null ? (
            <EmptyState
              detail="An authenticated Relay session is required to inspect disclosure history."
              title="Sign in required"
            />
          ) : disclosures.isPending ? (
            <EmptyState detail="Loading disclosure metadata..." title="Checking history" />
          ) : (
            <EmptyState
              detail="When Relay sends allowlisted fields to an AI provider, the metadata appears here."
              title="No AI disclosures"
            />
          )
        }
        ListHeaderComponent={
          <View style={{ gap: theme.relay.spacing.lg, marginBottom: theme.relay.spacing.sm }}>
            <AppButton label="Back to settings" onPress={() => router.back()} tone="secondary" />
            <View style={{ gap: theme.relay.spacing.sm }}>
              <AppText tone="accent" variant="eyebrow">
                EXPLAINABLE AI
              </AppText>
              <AppText variant="hero">Disclosure history</AppText>
              <AppText tone="muted">
                Inspect which field names were disclosed, to which model, and why. Raw prompts and
                source content are never shown or retained here.
              </AppText>
            </View>
            {disclosures.error === null ? null : (
              <View style={{ gap: theme.relay.spacing.sm }}>
                <StatusMessage tone="error">{privacyErrorMessage(disclosures.error)}</StatusMessage>
                <AppButton
                  label="Retry disclosure history"
                  onPress={() => void disclosures.refetch()}
                  tone="secondary"
                />
              </View>
            )}
          </View>
        }
        contentContainerStyle={{
          gap: theme.relay.spacing.md,
          padding: theme.relay.spacing.lg,
          paddingBottom: theme.relay.spacing.pageBottom,
        }}
        data={disclosures.data ?? []}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl
            onRefresh={() => void disclosures.refetch()}
            refreshing={disclosures.isRefetching}
            tintColor={theme.relay.colors.accent}
          />
        }
        renderItem={({ item }) => <DisclosureCard disclosure={item} />}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
});
