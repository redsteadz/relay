import { type ReactNode, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { AppScreen } from "@/components/AppScreen";
import { AppText, FeedbackState, LoadingState, StatusMessage } from "@/components/ui";
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
    <AppScreen
      action={action}
      backLabel="Back to source"
      detail={detail}
      onBack={onBack}
      scroll={false}
      title={title}
    >
      <QueueFilterBar
        filter={filter}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        query={query}
      />
      <View style={styles.resultHeading}>
        <AppText variant="label">Queue results</AppText>
        <AppText tone="accent" variant="caption">
          {filteredItems.length.toString()} items
        </AppText>
      </View>
      <StatusMessage tone="info">{offlineMessage}</StatusMessage>
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
    </AppScreen>
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
});
