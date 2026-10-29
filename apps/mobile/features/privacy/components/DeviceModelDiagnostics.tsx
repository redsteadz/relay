import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import {
  ActionRow,
  AppButton,
  AppText,
  EditorialSurface,
  EmptyState,
  StatusMessage,
  StatusPill,
} from "@/components/ui";
import { deviceSemanticResultExplanation } from "@/lib/device-semantic";
import { useRelayTheme } from "@/theme";

import { useDeviceModelDiagnostics } from "../hooks/useDeviceModelDiagnostics";
import {
  attemptExplanation,
  attemptLine,
  disclosureLine,
  formatAgo,
  formatDuration,
  listenerStateLine,
  passOutcomeExplanation,
  passPillLabel,
  passTitle,
  passTone,
} from "../models/deviceModelDiagnosticsPresentation";
import { deviceModelSummary } from "../models/deviceModelPresentation";
import { formatPrivacyDate } from "../models/privacyPresentation";

/**
 * Why a rule that asks a model did or did not get an answer, on the phone.
 *
 * Reads top to bottom as the question a reader arrives with: is the model set up, is the listener
 * connected, does the model answer when asked directly, what did the last passes do, what did each
 * request send and receive. Each section is metadata only -- no notification text, no question, no
 * key -- which is the same allowlist the structured logs keep, shown to the person who owns the
 * phone rather than to a console nobody attached.
 */
export function DeviceModelDiagnostics({ tenantId }: { tenantId: string | undefined }) {
  const theme = useRelayTheme();
  const { spacing } = theme.relay;
  const diagnostics = useDeviceModelDiagnostics(tenantId);
  const now = Date.now();

  if (tenantId === undefined) {
    return (
      <EmptyState
        detail="A model on this phone belongs to an account, so Relay needs you signed in to read it."
        title="Sign in to check your model"
      />
    );
  }

  const listener = listenerStateLine(diagnostics.capabilities);
  const probeExplanation =
    diagnostics.probeResult === undefined
      ? undefined
      : deviceSemanticResultExplanation(diagnostics.probeResult);

  return (
    <View style={[styles.screen, { gap: spacing.lg }]}>
      <EditorialSurface
        icon="brain"
        meta={diagnostics.config === undefined ? "Not set up" : "On this phone"}
        title="The model"
      >
        <AppText tone="muted">{deviceModelSummary(diagnostics.config)}</AppText>
        {diagnostics.config === undefined ? (
          <AppButton
            label="Set up a model"
            onPress={() => router.push("/your-data")}
            tone="secondary"
          />
        ) : null}
      </EditorialSurface>

      <EditorialSurface
        icon="bell-ring-outline"
        meta="Live"
        title="The listener"
        titleAccessory={
          <StatusPill
            label={listener.tone === "success" ? "Connected" : "Check"}
            tone={listener.tone}
          />
        }
      >
        <AppText tone="muted">{listener.detail}</AppText>
      </EditorialSurface>

      <EditorialSurface icon="flask-outline" meta="Synthetic" title="Ask it a test question">
        <AppText tone="muted">
          Sends one made-up marketing notification to your model and shows what came back. Nothing
          you received is sent. This is the quickest way to tell a model that is not answering from
          a pass that never reached it.
        </AppText>
        <ActionRow>
          <AppButton
            disabled={diagnostics.config === undefined || diagnostics.probing}
            label={diagnostics.probing ? "Asking…" : "Ask now"}
            loading={diagnostics.probing}
            onPress={() => void diagnostics.probe()}
          />
          <AppButton
            disabled={!diagnostics.canRunPass || diagnostics.running}
            label={diagnostics.running ? "Running…" : "Run the quiet pass now"}
            loading={diagnostics.running}
            onPress={() => void diagnostics.runQuietPass()}
            tone="secondary"
          />
        </ActionRow>
        {diagnostics.probeResult === undefined ? null : (
          <StatusMessage tone={diagnostics.probeResult.refusal === undefined ? "success" : "error"}>
            {diagnostics.probeResult.refusal === undefined
              ? `Your model answered ${
                  diagnostics.probeResult.decision === "match"
                    ? "yes, which is the expected answer"
                    : diagnostics.probeResult.decision === "no-match"
                      ? "no, which is unexpected for the test message but shows it is reachable"
                      : "but not confidently enough to count"
                } in ${formatDuration(diagnostics.probeResult.durationMs)}.`
              : `${probeExplanation ?? "Your model did not answer."} (${formatDuration(
                  diagnostics.probeResult.durationMs,
                )}${
                  diagnostics.probeResult.statusCode === undefined
                    ? ""
                    : `, HTTP ${String(diagnostics.probeResult.statusCode)}`
                })`}
          </StatusMessage>
        )}
        {diagnostics.lastPassActed === undefined ? null : (
          <AppText tone="muted" variant="caption">
            {`The pass finished. ${String(diagnostics.lastPassActed)} ${
              diagnostics.lastPassActed === 1 ? "notification was" : "notifications were"
            } put away or cleared. What it did is the first entry below.`}
          </AppText>
        )}
      </EditorialSurface>

      <EditorialSurface
        icon="history"
        meta={`${String(diagnostics.passes.length)} kept`}
        title="Recent passes"
      >
        <AppText tone="muted" variant="caption">
          Every time Relay looked for notifications waiting on a model, and where it stopped. The
          most recent is first.
        </AppText>
        {diagnostics.passes.length === 0 ? (
          <AppText tone="muted">
            No pass has run yet on this phone. One runs each time Relay opens, and in the background
            if you turned that on.
          </AppText>
        ) : (
          <View style={[styles.list, { gap: spacing.md }]}>
            {diagnostics.passes.map((report) => (
              <View key={`${report.startedAt}-${report.kind}`} style={{ gap: spacing.xxs }}>
                <View style={[styles.titleRow, { gap: spacing.sm }]}>
                  <AppText style={styles.grow} variant="label">
                    {passTitle(report)}
                  </AppText>
                  <StatusPill label={passPillLabel(report)} tone={passTone(report)} />
                </View>
                <AppText tone="muted" variant="caption">
                  {`${formatAgo(report.startedAt, now)} · took ${formatDuration(report.durationMs)}`}
                </AppText>
                <AppText tone="muted">{passOutcomeExplanation(report)}</AppText>
                {report.attempts.map((attempt, index) => {
                  const explanation = attemptExplanation(attempt);
                  return (
                    <View key={`${report.startedAt}-${String(index)}`} style={{ gap: spacing.xxs }}>
                      <AppText variant="monoMeta">{attemptLine(attempt)}</AppText>
                      {explanation === undefined ? null : (
                        <AppText tone="muted" variant="caption">
                          {explanation}
                        </AppText>
                      )}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        )}
        {diagnostics.passes.length === 0 ? null : (
          <AppButton
            label="Clear this list"
            onPress={() => void diagnostics.clear()}
            tone="secondary"
          />
        )}
      </EditorialSurface>

      <EditorialSurface icon="file-eye-outline" meta="Metadata only" title="What this phone sent">
        <AppText tone="muted" variant="caption">
          Each request this phone made to a model about a real capture: the model, the host, and how
          it ended. Field names and redaction counts are in the disclosure history; the text itself
          is never kept.
        </AppText>
        {diagnostics.disclosures.length === 0 ? (
          <AppText tone="muted">Nothing has been sent from this phone yet.</AppText>
        ) : (
          <View style={[styles.list, { gap: spacing.xs }]}>
            {diagnostics.disclosures.map((row) => (
              <View key={row.id} style={{ gap: spacing.xxs }}>
                <AppText variant="monoMeta">{disclosureLine(row)}</AppText>
                <AppText tone="muted" variant="caption">
                  {formatPrivacyDate(row.created_at)}
                </AppText>
              </View>
            ))}
          </View>
        )}
      </EditorialSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flexShrink: 1, flexGrow: 1 },
  list: { width: "100%" },
  screen: { width: "100%" },
  titleRow: { alignItems: "center", flexDirection: "row", width: "100%" },
});
