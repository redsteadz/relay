import { useMemo } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { ActivityIndicator } from "react-native-paper";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { ActionRow, AppButton, AppText, AppTextInput, StatusMessage } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import { SelectionRow, type SelectionItem } from "./SelectionRow";

type SelectorAction = {
  label: string;
  loading?: boolean;
  onPress: () => void;
};

type SourceSelectorScreenProps = {
  addAction?: SelectorAction | undefined;
  confirmDisabled: boolean;
  confirmLabel: string;
  confirmLoading?: boolean;
  detail: string;
  emptyMessage: string;
  error?: string | undefined;
  items: SelectionItem[];
  loading: boolean;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onQueryChange: (value: string) => void;
  onRetry?: (() => void) | undefined;
  onToggle: (id: string) => void;
  query: string;
  searchLabel: string;
  selectedCount: number;
  title: string;
};

export function SourceSelectorScreen({
  addAction,
  confirmDisabled,
  confirmLabel,
  confirmLoading = false,
  detail,
  emptyMessage,
  error,
  items,
  loading,
  onBack,
  onCancel,
  onConfirm,
  onQueryChange,
  onRetry,
  onToggle,
  query,
  searchLabel,
  selectedCount,
  title,
}: SourceSelectorScreenProps) {
  const theme = useRelayTheme();
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized.length === 0) return items;
    return items.filter((item) => item.searchText.toLocaleLowerCase().includes(normalized));
  }, [items, query]);

  return (
    <ReceiptScreen onBack={onBack} scroll={false} title={title}>
      <View style={[styles.controls, { gap: theme.relay.spacing.sm }]}>
        <AppText tone="muted" variant="caption">
          {detail}
        </AppText>
        <View style={styles.selectionHeading}>
          <AppText variant="label">Current selection</AppText>
          <AppText tone="accent" variant="monoMeta">
            {selectedCount.toString()} SELECTED
          </AppText>
        </View>
        <AppTextInput
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={searchLabel}
          label={searchLabel}
          onChangeText={onQueryChange}
          value={query}
        />
        {addAction === undefined ? null : (
          <AppButton
            label={addAction.label}
            {...(addAction.loading === undefined ? {} : { loading: addAction.loading })}
            onPress={addAction.onPress}
            tone="secondary"
          />
        )}
        {error === undefined ? null : (
          <View style={{ gap: theme.relay.spacing.sm }}>
            <StatusMessage tone="error">{error}</StatusMessage>
            {onRetry === undefined ? null : (
              <AppButton label="Retry" onPress={onRetry} tone="secondary" />
            )}
          </View>
        )}
      </View>
      <FlatList
        contentContainerStyle={{ flexGrow: 1 }}
        data={loading ? [] : filteredItems}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={[styles.empty, { gap: theme.relay.spacing.sm }]}>
            {loading ? (
              <ActivityIndicator color={theme.relay.colors.accent} />
            ) : (
              <AppText tone="muted">{emptyMessage}</AppText>
            )}
          </View>
        }
        renderItem={({ item }) => <SelectionRow item={item} onToggle={() => onToggle(item.id)} />}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />
      <ActionRow>
        <AppButton disabled={confirmLoading} label="Cancel" onPress={onCancel} tone="secondary" />
        <AppButton
          disabled={confirmDisabled || confirmLoading}
          label={confirmLabel}
          loading={confirmLoading}
          onPress={onConfirm}
        />
      </ActionRow>
    </ReceiptScreen>
  );
}

const styles = StyleSheet.create({
  controls: { flexShrink: 0 },
  empty: { alignItems: "center", flex: 1, justifyContent: "center" },
  list: { flex: 1 },
  selectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});
