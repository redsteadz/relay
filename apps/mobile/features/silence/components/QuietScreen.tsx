import { AppError } from "@relay/observability";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import {
  ActionRow,
  AppButton,
  AppSwitch,
  AppText,
  ContextualNotice,
  EditorialSurface,
  EmptyState,
  LoadingState,
  StatusMessage,
  StatusPill,
} from "@/components/ui";
import { useDeviceCaptureCapabilities } from "@/features/device-capture/hooks/useDeviceCaptureCapabilities";
import { useDeviceModel } from "@/features/privacy/hooks/useDeviceModel";
import { useAuth } from "@/lib/auth-context";
import { remainingWindowHours } from "@/lib/notification-silence";
import RelayDeviceIngress from "@/modules/relay-device-ingress";
import { useRelayTheme } from "@/theme";

import { useNotificationSilence } from "../hooks/useNotificationSilence";
import {
  capabilityNotice,
  decisionLabel,
  decisionTone,
  namedApplications,
  reviewSummary,
  silenceRuleRow,
  type SilenceRuleRow,
} from "../models/silencePresentation";

/** The safe message an `AppError` already carries, or a generic one for anything unclassified. */
function writeErrorMessage(error: unknown): string {
  return error instanceof AppError ? error.userMessage : "That change could not be saved.";
}

/**
 * The quiet controls.
 *
 * One screen rather than a section inside Rules, because the gates are a sequence a person moves
 * through -- watch, review, allow -- and a sequence read top to bottom is the only way the order
 * stays obvious. It also gives the stop somewhere unambiguous to live: the control that halts an
 * irreversible capability should not be reachable only by first finding the rule that holds it.
 *
 * Two things this screen must never do. It must not let clearing look like hiding -- hiding takes a
 * row out of Relay's inbox and never touches the phone. And it must not imply Relay can stop a
 * sound, because it cannot: Android hands a notification to a listener only after it has alerted,
 * and the hook that runs earlier is reserved for system apps. So the screen says what Relay does,
 * and hands over each app's own Android settings for the part it does not.
 */
export function QuietScreen() {
  const theme = useRelayTheme();
  const { spacing } = theme.relay;
  const { client, session } = useAuth();
  const tenantId = session?.user.id;
  const { capabilities, refresh: refreshCapabilities } = useDeviceCaptureCapabilities();
  const silence = useNotificationSilence(client, tenantId);
  // A rule that asks a model decides nothing without one, so the rows have to know whether this
  // phone has an endpoint rather than describing an effect that cannot happen (ADR-0019).
  const { config: deviceModel } = useDeviceModel(tenantId);

  // Until the first capability read lands, report the state that promises least. A screen that
  // briefly claims a capability it has not confirmed is worse than one that waits a frame.
  const notice = useMemo(
    () => capabilityNotice({ notificationListener: capabilities?.notificationListener ?? false }),
    [capabilities],
  );
  const applications = useMemo(() => namedApplications(silence.statuses), [silence.statuses]);

  const rows = useMemo(
    () =>
      silence.statuses.map((status) =>
        silenceRuleRow(status, {
          killSwitchEngaged: silence.killSwitchEngaged,
          modelConfigured: deviceModel !== undefined,
          remainingHours: remainingWindowHours(
            status.rule.dryRunStartedAt,
            silence.minimumWindowHours,
            Date.now(),
          ),
        }),
      ),
    [deviceModel, silence.killSwitchEngaged, silence.minimumWindowHours, silence.statuses],
  );

  if (session === null || tenantId === undefined) {
    return (
      <EmptyState
        detail="These rules belong to an account, so Relay needs you signed in to read them."
        title="Sign in to set up quiet rules"
      />
    );
  }

  return (
    <View style={[styles.screen, { gap: spacing.lg }]}>
      {/*
        The stop comes first on the page, not last. "Reachable in one step from any screen showing
        dismissal" is the requirement, and a control a person has to scroll to find is not that.
      */}
      <EditorialSurface
        icon="hand-back-left-outline"
        meta={silence.killSwitchEngaged ? "Everything stopped" : "Running"}
        title="Stop clearing notifications"
      >
        <AppText tone="muted">
          Turns off every rule here at once, on this phone immediately and on your account. Your
          rules and the watching you have already done are kept, so releasing it restores exactly
          what you had allowed.
        </AppText>
        <AppSwitch
          accessibilityHint="Stops every rule from changing any notification"
          detail={
            silence.killSwitchEngaged
              ? "No rule can change a notification while this is on."
              : "Rules are allowed to act."
          }
          disabled={silence.stopping}
          label="Stop all rules"
          onValueChange={(value) => {
            void silence.engageStop(value);
          }}
          value={silence.killSwitchEngaged}
        />
        {silence.stopError !== null && (
          <StatusMessage tone="error">
            The stop was applied on this phone but could not be saved to your account. Your other
            devices may still be clearing notifications.
          </StatusMessage>
        )}
      </EditorialSurface>

      <ContextualNotice
        accessibilityLabel="What Relay can and cannot do to a notification"
        tone={notice.tone}
      >
        {notice.detail}
      </ContextualNotice>

      {silence.isLoading ? (
        <LoadingState label="Reading which rules are allowed to clear notifications" />
      ) : rows.length === 0 ? (
        <EmptyState
          detail="A rule here has to name an app exactly, using “is” rather than a description. Write one in Rules and it will appear here."
          title="No rule can clear notifications yet"
        />
      ) : (
        <View style={[styles.list, { gap: spacing.md }]}>
          {rows.map((row) => (
            <QuietRuleCard key={row.filterRuleId} row={row} silence={silence} />
          ))}
        </View>
      )}

      {/*
        The honest part of the feature. Relay cannot stop a sound, so rather than leaving that as a
        caveat it hands over the control that can: the app's own notification settings, in Android's
        UI, changed by the person. The list is derived from the apps their own rules name, so this is
        a shortcut to a decision they have already half made.
      */}
      {applications.length > 0 && (
        <EditorialSurface
          icon="volume-off"
          meta="Android settings"
          title="Stop an app making noise"
        >
          <AppText tone="muted">
            Relay cannot stop a sound — Android alerts before it tells Relay anything. These are the
            apps your rules name; each one opens that app&apos;s own notification settings, where
            you can silence it or turn off a single channel.
          </AppText>
          <ActionRow>
            {applications.map((applicationId) => (
              <AppButton
                accessibilityHint={`Opens Android notification settings for ${applicationId}`}
                key={applicationId}
                label={applicationId}
                onPress={() => {
                  void (async () => {
                    await RelayDeviceIngress.openApplicationNotificationSettings(applicationId);
                    await refreshCapabilities();
                  })();
                }}
                tone="secondary"
              />
            ))}
          </ActionRow>
        </EditorialSurface>
      )}

      {/*
        A refusal carries its own deterministic reason -- the rule names no app, the window is not
        over -- and saying only "could not be saved" for one of those sends a reader to look for a
        fault that is not there.
      */}
      {silence.writeError !== null && (
        <StatusMessage tone="error">
          {`${writeErrorMessage(silence.writeError)} Nothing on your phone was altered.`}
        </StatusMessage>
      )}

      <EditorialSurface
        icon="history"
        meta={`${silence.outcomes.length} recorded`}
        title="What Relay decided"
      >
        <AppText tone="muted" variant="caption">
          Only notifications from apps your rules name. Relay records the app, the rule and the
          verdict — never the title or the text.
        </AppText>
        {silence.outcomes.length === 0 ? (
          <AppText tone="muted">
            Nothing yet. Decisions appear here as notifications arrive from the apps your rules
            name.
          </AppText>
        ) : (
          <View style={[styles.list, { gap: spacing.xs }]}>
            {silence.outcomes.slice(0, 20).map((outcome) => (
              <View key={outcome.envelopeId} style={[styles.outcome, { gap: spacing.xxs }]}>
                <AppText variant="body">{outcome.applicationId}</AppText>
                <StatusPill
                  label={decisionLabel(outcome.decision)}
                  tone={decisionTone(outcome.decision)}
                />
              </View>
            ))}
          </View>
        )}
      </EditorialSurface>
    </View>
  );
}

function QuietRuleCard({
  row,
  silence,
}: {
  row: SilenceRuleRow;
  silence: ReturnType<typeof useNotificationSilence>;
}) {
  const status = silence.statuses.find((entry) => entry.rule.id === row.filterRuleId);
  const summary = reviewSummary(silence.outcomes, row.filterRuleId);

  return (
    <EditorialSurface
      icon="bell-sleep-outline"
      title={row.name}
      titleAccessory={<StatusPill label={row.pill.label} tone={row.pill.tone} />}
    >
      <AppText tone="muted">{row.detail}</AppText>

      {/*
        The review is done against what the device actually recorded. Showing the misses alongside
        the matches is the point: a rule that matched everything from an app is a different rule
        than the person thought they wrote, and only the miss count reveals it.
      */}
      {row.action === "review" && (
        <AppText tone="muted" variant="caption">
          {`${summary.matched} matched, ${summary.missed} did not, out of ${summary.observed} seen from the apps your rules name.`}
        </AppText>
      )}

      <ActionRow>
        {/*
          Two buttons rather than one plus a picker, because the choice between them is the whole
          decision: one is reversible and one is not. Hiding that behind a default selection would
          make the irreversible option the easy one to pick by accident.

          They stay available at the review step as well. Changing which action a rule takes
          restarts the window -- what a person watched a snoozing rule do is not evidence about the
          same rule cancelling -- and without them here a reader who chose wrongly would have to sit
          out three days before they could choose again.
        */}
        {(row.action === "observe" || row.action === "review") && (
          <>
            <AppButton
              accessibilityHint="Starts a three-day period in which Relay records what this rule would do, then lets it put matching notifications away for two hours"
              disabled={silence.observing}
              label={row.action === "review" ? "Watch again, to put away" : "Watch, then put away"}
              onPress={() => {
                void silence.observe({ action: "snooze", filterRuleId: row.filterRuleId });
              }}
              tone="secondary"
            />
            <AppButton
              accessibilityHint="Starts a three-day period in which Relay records what this rule would do, then lets it clear matching notifications for good"
              disabled={silence.observing}
              label={
                row.action === "review"
                  ? "Watch again, to clear for good"
                  : "Watch, then clear for good"
              }
              onPress={() => {
                void silence.observe({ action: "dismiss", filterRuleId: row.filterRuleId });
              }}
              tone="secondary"
            />
          </>
        )}
        {row.action === "review" && (
          <AppButton
            accessibilityHint="Records what this rule decided and allows it to put matching notifications away"
            disabled={silence.completing || silence.authorizing}
            label="Allow this rule to act"
            onPress={() => {
              const startedAt = status?.rule.dryRunStartedAt;
              void (async () => {
                if (status?.rule.dryRunCompletedAt === undefined) {
                  await silence.completeObservation({
                    filterRuleId: row.filterRuleId,
                    since: startedAt === undefined ? 0 : Date.parse(startedAt),
                  });
                }
                await silence.authorize({ enabled: true, filterRuleId: row.filterRuleId });
              })();
            }}
          />
        )}
        {row.action === "withdraw" && (
          <AppButton
            accessibilityHint="Stops this rule from changing any notification"
            disabled={silence.authorizing}
            label="Stop this rule"
            onPress={() => {
              void silence.authorize({ enabled: false, filterRuleId: row.filterRuleId });
            }}
            tone="secondary"
          />
        )}
      </ActionRow>
    </EditorialSurface>
  );
}

const styles = StyleSheet.create({
  list: { width: "100%" },
  outcome: { alignItems: "flex-start", width: "100%" },
  screen: { width: "100%" },
});
