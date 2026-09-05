import { router } from "expo-router";
import { FlatList, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  ActionRow,
  AppButton,
  AppText,
  EmptyState,
  FeedbackState,
  LoadingState,
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
    <ReceiptScreen onBack={() => router.back()} scroll={false} title="Disclosure history">
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
            <AppText tone="muted" variant="caption">
              Which field names were disclosed, to which model, and why. Raw prompts and source
              content are never shown or retained here.
            </AppText>
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
    </ReceiptScreen>
  );
}
