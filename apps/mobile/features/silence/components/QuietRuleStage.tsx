import type { NotificationSilenceOutcome } from "@relay/contracts";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { ActionRow, AppButton, AppText, StatusMessage, StatusPill } from "@/components/ui";
import {
  passOutcomeExplanation,
  formatAgo,
} from "@/features/privacy/models/deviceModelDiagnosticsPresentation";
import type { DeviceModelPassReport } from "@/lib/device-semantic-diagnostics";
import RelayDeviceIngress from "@/modules/relay-device-ingress";
import { useRelayTheme } from "@/theme";

import {
  decisionLabel,
  decisionTone,
  QUIET_CHOICES,
  type QuietChoice,
  type QuietStageState,
} from "../models/silencePresentation";

/** How many of a rule's verdicts the editor shows. The rest are history, not evidence. */
const VERDICTS_SHOWN = 10;

/**
 * The stage of the rule editor that decides what a rule does to a matching notification.
 *
 * This used to be a screen of its own under Settings, with its own list of rules and its own
 * sequence of gates. A reader writing a rule had to finish it, leave, find the quiet screen, find
 * the rule again and authorize it there -- and a reader looking at a rule had no way to see whether
 * it quieted anything. The choice is a property of the rule, so it is made where the rule is made
 * ([ADR-0023](../../../../docs/decisions/0023-quiet-on-the-rule-and-model-diagnostics.md)).
 *
 * Three things this stage must keep saying. Clearing is not hiding: hiding takes a row out of
 * Relay's inbox and never touches the phone. Snoozing is not dismissing: Android brings a snoozed
 * notification back and nothing brings back a cancelled one, so the two never share a sentence. And
 * Relay cannot stop a sound: Android alerts before it tells Relay anything, so the stage hands over
 * each named app's own Android settings for the part Relay cannot do.
 */
export function QuietRuleStage({
  applications,
  choice,
  disabled,
  latestPass,
  onChoose,
  outcomes,
  state,
}: {
  /** Apps the draft names outright, each of which Android can silence at the source. */
  applications: readonly string[];
  choice: QuietChoice;
  disabled: boolean;
  /** The most recent quiet pass, when the journal has one, so a waiting verdict can say why. */
  latestPass: DeviceModelPassReport | undefined;
  onChoose: (choice: QuietChoice) => void;
  /** This rule's verdicts, newest first, already joined with each notification's title. */
  outcomes: readonly NotificationSilenceOutcome[];
  state: QuietStageState;
}) {
  const theme = useRelayTheme();
  const { spacing } = theme.relay;
  const blocked = state.blocked !== undefined;
  const waiting = outcomes.some((outcome) => outcome.decision === "awaiting-model");

  return (
    <View style={{ gap: spacing.md }}>
      <AppText tone="muted" variant="caption">
        Android tells Relay about a notification only after your phone has made its sound, so a rule
        here puts a notification away rather than stopping the noise.
      </AppText>

      {/*
        Four buttons rather than a picker. The choice between reversible and not is the whole
        decision, and hiding the irreversible one behind a default selection would make it the easy
        one to pick by accident. Each is live only when the rule could act at all.
      */}
      <View style={[styles.choices, { gap: spacing.xs }]}>
        {QUIET_CHOICES.map((entry) => (
          <AppButton
            accessibilityHint={entry.detail}
            disabled={disabled || (blocked && entry.value !== "none")}
            key={entry.value}
            label={entry.label}
            onPress={() => onChoose(entry.value)}
            tone={
              choice === entry.value
                ? entry.value === "dismiss"
                  ? "destructive"
                  : "primary"
                : "secondary"
            }
          />
        ))}
      </View>

      {state.blocked === undefined ? (
        <AppText tone="muted">{state.detail}</AppText>
      ) : (
        <StatusMessage tone="info">{state.blocked}</StatusMessage>
      )}

      {state.needsModel ? (
        <ActionRow>
          <AppButton
            accessibilityHint="Opens Your data, where a model on this phone is set up"
            label="Set up a model"
            onPress={() => router.push("/your-data")}
            tone="secondary"
          />
        </ActionRow>
      ) : null}

      {/*
        The honest part of the feature. Relay cannot stop a sound, so rather than leaving that as a
        caveat it hands over the control that can: the app's own notification settings, in Android's
        UI, changed by the person.
      */}
      {applications.length === 0 ? null : (
        <View style={{ gap: spacing.xs }}>
          <AppText tone="muted" variant="caption">
            To stop an app making noise at all, use its own notification settings:
          </AppText>
          <ActionRow>
            {applications.map((applicationId) => (
              <AppButton
                accessibilityHint={`Opens Android notification settings for ${applicationId}`}
                key={applicationId}
                label={applicationId}
                onPress={() => {
                  void RelayDeviceIngress.openApplicationNotificationSettings(applicationId);
                }}
                tone="secondary"
              />
            ))}
          </ActionRow>
        </View>
      )}

      {/*
        What this rule decided, by notification. Shown whenever there is anything to show, not only
        while watching: a rule that is acting should be as readable as one that is rehearsing.
      */}
      {outcomes.length === 0 ? null : (
        <View style={{ gap: spacing.xs }}>
          <AppText variant="label">What this rule decided</AppText>
          <AppText tone="muted" variant="caption">
            Relay records the app, the rule and the verdict. The title is read from your phone's own
            copy of the notification and is never stored with the verdict.
          </AppText>
          <View style={{ gap: spacing.xs }}>
            {outcomes.slice(0, VERDICTS_SHOWN).map((outcome) => (
              <View key={outcome.envelopeId} style={[styles.outcome, { gap: spacing.xxs }]}>
                <View style={styles.outcomeText}>
                  <AppText numberOfLines={2} variant="body">
                    {outcome.subject ?? outcome.applicationId}
                  </AppText>
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
              </View>
            ))}
          </View>
        </View>
      )}

      {/*
        A verdict that says "waiting on your model" is a question, and this is the answer: what the
        last pass that could have asked actually did. Without it, "waiting" is indistinguishable from
        "never going to happen", which is the state this feature spent a while in.
      */}
      {waiting ? (
        <StatusMessage tone={latestPass === undefined ? "info" : "warning"}>
          {latestPass === undefined
            ? "Some of these are waiting on your model. No pass has asked it yet on this phone; one runs each time Relay opens."
            : `Some of these are waiting on your model. The last pass, ${formatAgo(
                latestPass.startedAt,
                Date.now(),
              )}: ${passOutcomeExplanation(latestPass)}`}
        </StatusMessage>
      ) : null}
      {waiting ? (
        <ActionRow>
          <AppButton
            accessibilityHint="Opens the page that shows whether this phone's model is being asked, and what it answered"
            label="Check the model"
            onPress={() => router.push("/device-model")}
            tone="secondary"
          />
        </ActionRow>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Wraps rather than scrolls sideways, like the category buttons above it: a choice off the edge of
  // a row is one a person never sees, and these four must all be seen.
  choices: { flexDirection: "row", flexWrap: "wrap" },
  outcome: { alignItems: "flex-start", width: "100%" },
  outcomeText: { flexShrink: 1 },
});
