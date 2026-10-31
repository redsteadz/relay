import { AppError } from "@relay/observability";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { storedRefusalExplanation } from "@/lib/device-semantic";
import { reportUnexpectedUiError } from "@/lib/observability";
import { remainingWindowHours } from "@/lib/notification-silence";
import RelayDeviceIngress, { type NativeSilenceDiagnostics } from "@/modules/relay-device-ingress";
import { useRelayTheme } from "@/theme";

import { runQuietPass, type QuietPassReport } from "../api/silenceResolution";
import { useNotificationSilence } from "../hooks/useNotificationSilence";
import { firstBlockingLine, quietDiagnosticLines } from "../models/quietDiagnostics";
import {
  capabilityNotice,
  decisionLabel,
  decisionTone,
  namedApplications,
  reviewSummary,
  silenceRuleRow,
  type SilenceRuleRow,
} from "../models/silencePresentation";

/**
 * The state of every stage between a notification arriving and a rule deciding.
 *
 * Reads the device's own counts on mount, and runs a real pass on demand rather than simulating
 * one -- a simulation would be a second implementation of the thing being diagnosed, and the bug
 * worth finding is as likely to be there as anywhere.
 *
 * The pass is the one place a thrown error matters. `DeviceCaptureSync` runs the same call through
 * `runInBackground`, whose log reaches a console that a release build does not forward anywhere,
 * so a pass that throws on every attempt looks exactly like a pass that finds nothing to do. Here
 * it is caught and shown.
 */
function useQuietDiagnostics(client: ReturnType<typeof useAuth>["client"], tenantId?: string) {
  const [native, setNative] = useState<NativeSilenceDiagnostics>();
  const [pass, setPass] = useState<QuietPassReport>();
  const [failure, setFailure] = useState<string>();
  const [running, setRunning] = useState(false);

  const read = useCallback(async () => {
    if (tenantId === undefined) return;
    try {
      setNative(await RelayDeviceIngress.getNotificationSilenceDiagnostics(tenantId));
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : "The device could not be read.");
    }
  }, [tenantId]);

  useEffect(() => {
    void read();
  }, [read]);

  const run = useCallback(async () => {
    if (client === undefined || tenantId === undefined) return;
    setRunning(true);
    setFailure(undefined);
    try {
      setPass(await runQuietPass(client, tenantId));
    } catch (error: unknown) {
      // The failure a reader could never see. Shown verbatim because it is this device telling
      // this device's owner why their own rule is not running, and a deterministic substitute
      // would hide the one detail that identifies the stage.
      setFailure(error instanceof Error ? error.message : "The pass failed.");
    } finally {
      setRunning(false);
      await read();
    }
  }, [client, read, tenantId]);

  return { failure, native, pass, run, running };
}

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
  const diagnostics = useQuietDiagnostics(client, tenantId);
  const diagnosticLines = useMemo(
    () => quietDiagnosticLines(diagnostics.native, deviceModel, diagnostics.pass),
    [deviceModel, diagnostics.native, diagnostics.pass],
  );
  const blocking = firstBlockingLine(diagnosticLines);

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
          detail="Any rule your phone can check as a notification arrives can clear one. Write one in Rules and it will appear here."
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

      {/*
        The chain, stage by stage.

        Placed above the verdict list because when nothing is being decided, the verdict list is
        empty and says nothing about why -- which was the whole problem.
      */}
      <EditorialSurface
        icon="stethoscope"
        meta="On this phone"
        title="Why rules are or are not deciding"
      >
        <AppText tone="muted" variant="caption">
          Counts and modes only. Nothing here names a notification, an app or a rule.
        </AppText>
        {diagnosticLines.map((line) => (
          <View key={line.label} style={[styles.outcome, { gap: spacing.xxs }]}>
            <View style={styles.outcomeText}>
              <AppText variant="body">{line.label}</AppText>
              {line.detail === undefined ? null : (
                <AppText tone="muted" variant="caption">
                  {line.detail}
                </AppText>
              )}
            </View>
            <StatusPill label={line.value} tone={line.ok ? "success" : "warning"} />
          </View>
        ))}
        {blocking === undefined ? (
          <StatusMessage tone="success">
            Every stage is ready. A matching notification that is still on screen will be decided on
            the next pass.
          </StatusMessage>
        ) : (
          <StatusMessage tone="warning">
            {`First thing stopping it: ${blocking.label} -- ${blocking.value}.`}
          </StatusMessage>
        )}
        {diagnostics.failure === undefined ? null : (
          <StatusMessage tone="error">
            {`The pass itself failed: ${diagnostics.failure}`}
          </StatusMessage>
        )}
        <AppButton
          disabled={diagnostics.running}
          label={diagnostics.running ? "Running a pass..." : "Run a pass now"}
          loading={diagnostics.running}
          onPress={() => {
            void diagnostics.run();
          }}
          tone="secondary"
        />
      </EditorialSurface>

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
                <View style={styles.outcomeText}>
                  {/* The title first: which notification this was is the question a reviewer has,
                      and the application id alone never answered it. */}
                  <AppText variant="body">{outcome.subject ?? outcome.applicationId}</AppText>
                  {outcome.subject === undefined ? null : (
                    <AppText tone="muted" variant="caption">
                      {outcome.applicationId}
                    </AppText>
                  )}
                </View>
                <StatusPill
                  label={decisionLabel(outcome.decision)}
                  tone={decisionTone(outcome.decision)}
                />
                {/* Why the wait is a wait, when the device knows. "Waiting on your model" is
                    otherwise the same row for a model that is thinking and one that is refusing
                    every request, and the refusing case leaves no trace at the provider either. */}
                {storedRefusalExplanation(outcome.refusal) === undefined ? null : (
                  <AppText tone="muted" variant="caption">
                    {storedRefusalExplanation(outcome.refusal)}
                  </AppText>
                )}
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

  /**
   * Enables the rule with the action the reader just named.
   *
   * An open observation window is closed first so its counts land in the audit record, which is the
   * evidence of what the reader was looking at when they decided. A window that never started has
   * nothing to close, and one too young for the server to accept is not a reason to refuse the
   * enable -- the evidence is a record, not a gate (ADR-0021).
   */
  async function enableWith(action: "dismiss" | "snooze"): Promise<void> {
    const startedAt = status?.rule.dryRunStartedAt;
    if (startedAt !== undefined && status?.rule.dryRunCompletedAt === undefined) {
      try {
        await silence.completeObservation({
          filterRuleId: row.filterRuleId,
          since: Date.parse(startedAt),
        });
      } catch (cause: unknown) {
        reportUnexpectedUiError(cause, "ui.silence_observation_not_recorded", {
          code: "SILENCE_OBSERVATION_NOT_RECORDED",
          integration: "supabase-postgrest",
          operation: "completeDryRun",
        });
      }
    }
    await silence.authorize({ action, enabled: true, filterRuleId: row.filterRuleId });
  }

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
      {(row.action === "review" || row.stage === "observing") && (
        <AppText tone="muted" variant="caption">
          {`${summary.matched} matched, ${summary.missed} did not, out of ${summary.observed} seen from the apps your rules name.`}
        </AppText>
      )}

      <ActionRow>
        {/*
          Two buttons rather than one plus a picker, because the choice between them is the whole
          decision: one is reversible and one is not. Hiding that behind a default selection would
          make the irreversible option the easy one to pick by accident.

          Both are live wherever the rule is not already acting, and both are live *as* the enable
          -- a reader who knows what their rule does says so once rather than starting a clock
          (ADR-0021). Whichever they press records the evidence gathered so far, if any.
        */}
        {(row.action === "authorize" || row.action === "review") && (
          <>
            <AppButton
              accessibilityHint="Lets this rule put matching notifications away for two hours, starting now"
              disabled={silence.completing || silence.authorizing}
              label="Put matching ones away"
              onPress={() => {
                void enableWith("snooze");
              }}
            />
            <AppButton
              accessibilityHint="Lets this rule clear matching notifications for good, starting now. This cannot be undone for a notification it clears."
              disabled={silence.completing || silence.authorizing}
              label="Clear matching ones for good"
              onPress={() => {
                void enableWith("dismiss");
              }}
              tone="destructive"
            />
          </>
        )}
        {/*
          Watching is a second control now, not a precondition. It is for the reader who wants to
          read a few verdicts before deciding, and it is offered only where there is nothing to read
          yet.
        */}
        {row.offersObservation && (
          <AppButton
            accessibilityHint="Records what this rule would do without changing any notification, so you can read its verdicts before letting it act"
            disabled={silence.observing}
            label="Watch it first"
            onPress={() => {
              void silence.observe({ action: "snooze", filterRuleId: row.filterRuleId });
            }}
            tone="secondary"
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
  outcomeText: { flexShrink: 1 },
  outcome: { alignItems: "flex-start", width: "100%" },
  screen: { width: "100%" },
});
