import { View } from "react-native";

import { AppText, ContextualNotice, EditorialSurface, StatusMessage } from "@/components/ui";
import { useRelayTheme } from "@/theme";

import type { InboxItem } from "../models/inboxPresentation";

const ICON: Record<string, string> = {
  actionable: "calendar-check",
  "needs-review": "alert-decagram-outline",
  quiet: "tray-full",
};

function percent(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${Math.round(value * 100)}% confidence`;
}

/**
 * One inbox item and the evidence behind it.
 *
 * Detail is assembled from derived fields only. The encrypted raw payload is never read here, so an
 * item still explains itself after its raw copy expires.
 */
export function InboxItemCard({ item }: { item: InboxItem }) {
  const theme = useRelayTheme();
  const confidence = percent(item.confidence);
  return (
    <EditorialSurface
      icon={ICON[item.group] ?? "tray-full"}
      meta={[item.appLabel, item.category?.name].filter(Boolean).join(" · ")}
      title={item.title}
      variant={item.group === "actionable" ? "accent" : "raised"}
    >
      {item.summary === undefined ? null : <AppText tone="muted">{item.summary}</AppText>}

      {item.reviewReasons.map((reason) => (
        <StatusMessage key={reason} tone="warning">
          {reason}
        </StatusMessage>
      ))}

      <View style={{ gap: theme.relay.spacing.xxs }}>
        {item.scheduledAt === undefined ? null : (
          <AppText tone="muted" variant="caption">
            Scheduled {item.scheduledAt}
          </AppText>
        )}
        {confidence === undefined ? null : (
          <AppText tone="muted" variant="caption">
            {confidence}
          </AppText>
        )}
        {item.evidence.length === 0 ? null : (
          <AppText tone="muted" variant="caption">
            Evidence: {item.evidence.map((entry) => `${entry.kind} ${entry.label}`).join(" · ")}
          </AppText>
        )}
        {item.category === undefined ? null : (
          <AppText tone="muted" variant="caption">
            Filed by {item.category.method} rule
            {item.category.rationale === undefined ? "" : ` · ${item.category.rationale}`}
          </AppText>
        )}
      </View>

      {item.processing === "pending" ? (
        <ContextualNotice accessibilityLabel="Why this item is incomplete" tone="warning">
          Relay accepted this capture but has not finished processing it, so its facts may still be
          incomplete.
        </ContextualNotice>
      ) : null}

      {item.retention.rawExpired ? (
        <ContextualNotice accessibilityLabel="Raw copy retention" tone="info">
          The encrypted original expired and was deleted. This summary is what Relay retains.
        </ContextualNotice>
      ) : null}
    </EditorialSurface>
  );
}
