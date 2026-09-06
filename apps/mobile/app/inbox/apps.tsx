import { useRouter } from "expo-router";
import { View } from "react-native";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import { AppText, EditorialSurface, FeedbackState, LoadingState } from "@/components/ui";
import { useApplicationLabels } from "@/features/inbox/hooks/useApplicationLabels";
import { useInbox } from "@/features/inbox/hooks/useInbox";
import { formatCaptureTime, summariseByApp } from "@/features/inbox/models/inboxPresentation";
import { useRelayTheme } from "@/theme";

/**
 * Which applications are producing captures, and how much.
 *
 * Ordered by what is waiting on a person first and volume second, so the loudest source is never
 * also the most prominent one purely by being loud. Reading this before any single notification is
 * the point: a person decides which source to spend attention on, rather than meeting a wall of
 * rows and working it out from the middle.
 */
export default function InboxApplicationsScreen() {
  const router = useRouter();
  const theme = useRelayTheme();
  const inbox = useInbox();

  const items = inbox.sections.flatMap((section) => section.items);
  const labels = useApplicationLabels(
    items.flatMap((item) =>
      item.source.applicationId === undefined ? [] : [item.source.applicationId],
    ),
  );
  const applications = summariseByApp(items, labels);

  return (
    <ReceiptScreen onBack={() => router.back()} title="Applications">
      {inbox.loading ? <LoadingState label="Reading your inbox..." /> : null}

      {!inbox.loading && applications.length === 0 ? (
        <FeedbackState
          detail="Once a connected source sends something, it will be listed here."
          kind="empty"
          title="Nothing captured yet"
        />
      ) : null}

      {applications.map((application) => {
        const waiting = application.actionable + application.needsReview;
        return (
          <EditorialSurface
            accessibilityHint={`Opens captures from ${application.label}`}
            icon={application.icon}
            key={application.key}
            meta={formatCaptureTime(application.latestOccurredAt)}
            onPress={() => router.push(`/inbox/app/${encodeURIComponent(application.key)}`)}
            title={application.label}
            variant={waiting > 0 ? "accent" : "raised"}
          >
            <View style={{ gap: theme.relay.spacing.xxs }}>
              <AppText tone="muted" variant="caption">
                {application.captures} capture{application.captures === 1 ? "" : "s"}
                {application.conversations === application.captures
                  ? ""
                  : ` · ${application.conversations.toString()} conversation${
                      application.conversations === 1 ? "" : "s"
                    }`}
              </AppText>
              {waiting === 0 ? null : (
                <AppText tone="accent" variant="caption">
                  {application.actionable > 0
                    ? `${application.actionable.toString()} needing doing`
                    : ""}
                  {application.actionable > 0 && application.needsReview > 0 ? " · " : ""}
                  {application.needsReview > 0
                    ? `${application.needsReview.toString()} needing review`
                    : ""}
                </AppText>
              )}
            </View>
          </EditorialSurface>
        );
      })}
    </ReceiptScreen>
  );
}
