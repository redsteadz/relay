import { type ReactNode, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { AppText, ContextualNotice, FeedbackState, LoadingState } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import {
  filterQueueItems,
  type QueueTimeFilter,
  type SourceQueueItem,
} from "../../models/queuePresentation";
import { QueueFilterBar } from "./QueueFilterBar";
import { SourceQueueRow } from "./SourceQueueRow";

type SourceQueueScreenProps = {
  action?: ReactNode;
  detail: string;
  emptyMessage: string;
  error?: string | undefined;
  items: SourceQueueItem[];
  loading: boolean;
  onBack: () => void;
  onItemPress: (item: SourceQueueItem) => void;
  onRefresh: () => void;
  offlineMessage: string;
  title: string;
};

export function SourceQueueScreen({
  action,
  detail,
  emptyMessage,
  error,
  items,
  loading,
  onBack,
  onItemPress,
  onRefresh,
  offlineMessage,
  title,
}: SourceQueueScreenProps) {
  const theme = useRelayTheme();
  const [filter, setFilter] = useState<QueueTimeFilter>("all");
  const [query, setQuery] = useState("");
  const filteredItems = useMemo(
    () => filterQueueItems(items, query, filter),
    [filter, items, query],
  );

  return (
    <ReceiptScreen action={action} onBack={onBack} scroll={false} title={title}>
      <AppText tone="muted" variant="caption">
        {detail}
      </AppText>
      <QueueFilterBar
        filter={filter}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        query={query}
      />
      <View style={styles.resultHeading}>
        <View style={[styles.resultTitle, { gap: theme.relay.spacing.xxs }]}>
          <AppText variant="label">Queue results</AppText>
          <ContextualNotice accessibilityLabel="About the encrypted queue">
            {offlineMessage}
          </ContextualNotice>
        </View>
        <AppText tone="accent" variant="caption">
          {filteredItems.length.toString()} items
        </AppText>
      </View>
      <FlatList
        contentContainerStyle={[
          { paddingBottom: theme.relay.spacing.lg },
          filteredItems.length === 0 && styles.grow,
        ]}
        data={error === undefined ? filteredItems : []}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          error !== undefined ? (
            <FeedbackState
              action={undefined}
              detail={error}
              kind="error"
              title="Could not read this queue"
            />
          ) : loading ? (
            <LoadingState label="Reading encrypted queue..." />
          ) : (
            <FeedbackState detail={emptyMessage} title="Queue is empty" />
          )
        }
        refreshControl={
          <RefreshControl
            colors={[theme.relay.colors.accent]}
            onRefresh={onRefresh}
            refreshing={loading}
            tintColor={theme.relay.colors.accent}
          />
        }
        renderItem={({ item }) => <SourceQueueRow item={item} onPress={() => onItemPress(item)} />}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />
    </ReceiptScreen>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  list: { flex: 1 },
  resultHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  resultTitle: { alignItems: "center", flexDirection: "row" },
});
