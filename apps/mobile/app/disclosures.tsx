import { router } from "expo-router";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import {
  ActionRow,
  AppButton,
  EmptyState,
  FeedbackState,
  LoadingState,
  ScreenHeader,
  StatusMessage,
} from "@/components/ui";
import { DisclosureCard } from "@/features/privacy/components/DisclosureCard";
import { useDisclosureHistory } from "@/features/privacy/hooks/usePrivacySettings";
import { privacyErrorMessage } from "@/features/privacy/models/privacyPresentation";
import { useAuth } from "@/lib/auth-context";
import { useRelayTheme } from "@/theme";

export default function DisclosuresScreen() {
  const theme = useRelayTheme();
  const insets = useSafeAreaInsets();
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
            <FeedbackState
              detail="An authenticated Relay session is required to inspect disclosure history."
              kind="permission"
              title="Sign in required"
            />
          ) : disclosures.isPending ? (
            <LoadingState label="Checking disclosure history..." />
          ) : (
            <EmptyState
              detail="When Relay sends allowlisted fields to an AI provider, the metadata appears here."
              title="No AI disclosures"
            />
          )
        }
        ListHeaderComponent={
          <View style={{ gap: theme.relay.spacing.lg, marginBottom: theme.relay.spacing.sm }}>
            <ScreenHeader
              backLabel="Back to settings"
              detail="Inspect which field names were disclosed, to which model, and why. Raw prompts and source content are never shown or retained here."
              eyebrow="Explainable AI"
              onBack={() => router.back()}
              title="Disclosure history"
            />
            {disclosures.error === null ? null : (
              <View style={{ gap: theme.relay.spacing.sm }}>
                <StatusMessage tone="error">{privacyErrorMessage(disclosures.error)}</StatusMessage>
                <ActionRow>
                  <AppButton
                    label="Retry disclosure history"
                    onPress={() => void disclosures.refetch()}
                    tone="secondary"
                  />
                </ActionRow>
              </View>
            )}
          </View>
        }
        contentContainerStyle={{
          gap: theme.relay.spacing.md,
          padding: theme.relay.spacing.lg,
          paddingBottom: theme.relay.layout.screenBottom + insets.bottom,
        }}
        data={disclosures.data ?? []}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        style={{
          alignSelf: "center",
          maxWidth: theme.relay.sizes.contentMaxWidth,
          width: "100%",
        }}
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
