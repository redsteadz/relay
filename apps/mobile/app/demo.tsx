import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef, useState } from "react";

import { ReceiptScreen } from "@/components/ReceiptScreen";
import {
  ActionRow,
  AppButton,
  AppText,
  AppTextInput,
  ConfirmationDialog,
  ContextualNotice,
  EditorialSurface,
  StatusMessage,
} from "@/components/ui";
import { ReceiptStage } from "@/features/inbox/components/ReceiptStage";
import { generateDemoCapture, resetDemoData, type DemoCaptureOutcome } from "@/lib/demo/capture";
import type { DemoCaptureInput } from "@/lib/demo/ingest";
import { demoModeEnabled } from "@/lib/demo/mode";
import {
  customScenarioInput,
  DEMO_BURST_SCENARIO_IDS,
  DEMO_SCENARIOS,
  demoScenario,
} from "@/lib/demo/scenarios";
import { reportUnexpectedUiError } from "@/lib/observability";

/**
 * The Demo studio.
 *
 * Present only in a demo build, and it does one thing: put a capture into the account without
 * waiting for a real notification to arrive. What it sends is an envelope, so everything downstream
 * -- the fact normalizer, the event extractor, the classifier, the receipt -- is the shipped code
 * doing its ordinary work on synthetic input.
 *
 * It reports the classification it got rather than claiming success, because the interesting cases
 * are the ones where no rule claims a capture or a rule cannot read what it needs.
 */
export default function DemoStudioScreen() {
  const queryClient = useQueryClient();
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [outcome, setOutcome] = useState<DemoCaptureOutcome>();
  const [resetVisible, setResetVisible] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [applicationId, setApplicationId] = useState("com.whatsapp");
  const [sender, setSender] = useState("Sam Okafor");
  const [subject, setSubject] = useState("Dinner Friday");
  const [body, setBody] = useState("Booked the table for 8pm.");

  if (!demoModeEnabled()) {
    return (
      <ReceiptScreen onBack={() => router.back()} title="Demo studio">
        <StatusMessage tone="warning">
          This build is not a demo build, so there is nothing to generate here.
        </StatusMessage>
      </ReceiptScreen>
    );
  }

  async function send(input: DemoCaptureInput) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await generateDemoCapture(input);
      setOutcome(result);
      await queryClient.invalidateQueries();
    } catch (failure: unknown) {
      reportUnexpectedUiError(failure, "ui.demo_capture_failed", {
        code: "DEMO_CAPTURE_FAILED",
        integration: "relay-demo",
        operation: "generateDemoCapture",
      });
      setError("Could not generate that capture.");
    } finally {
      setBusy(false);
    }
  }

  async function sendScenario(id: string) {
    const scenario = demoScenario(id);
    if (scenario === undefined) return;
    sequence.current += 1;
    await send(scenario.build(Date.now(), sequence.current));
  }

  async function sendBurst() {
    setBusy(true);
    setError(undefined);
    try {
      for (const id of DEMO_BURST_SCENARIO_IDS) {
        const scenario = demoScenario(id);
        if (scenario === undefined) continue;
        sequence.current += 1;
        setOutcome(await generateDemoCapture(scenario.build(Date.now(), sequence.current)));
      }
      await queryClient.invalidateQueries();
    } catch (failure: unknown) {
      reportUnexpectedUiError(failure, "ui.demo_burst_failed", {
        code: "DEMO_BURST_FAILED",
        integration: "relay-demo",
        operation: "generateDemoCapture",
      });
      setError("Could not generate that burst.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setResetting(true);
    setError(undefined);
    try {
      await resetDemoData();
      setOutcome(undefined);
      await queryClient.invalidateQueries();
    } catch (failure: unknown) {
      reportUnexpectedUiError(failure, "ui.demo_reset_failed", {
        code: "DEMO_RESET_FAILED",
        integration: "relay-demo",
        operation: "resetDemoData",
      });
      setError("Could not reset the demo account.");
    } finally {
      setResetting(false);
      setResetVisible(false);
    }
  }

  const receiptId = outcome?.eventIds[0];

  return (
    <ReceiptScreen onBack={() => router.back()} title="Demo studio">
      <ContextualNotice accessibilityLabel="What this build is">
        Everything in this build is local and synthetic. Captures are derived on the device by the
        same normalizer and extractor the pipeline runs, rules are compiled by the same compiler,
        and no message, key or approval leaves the phone. An approved action is recorded, never
        sent.
      </ContextualNotice>

      {error === undefined ? null : <StatusMessage tone="error">{error}</StatusMessage>}

      {outcome === undefined ? null : (
        <>
          <StatusMessage tone="success">{outcome.outcome}</StatusMessage>
          <AppText tone="muted" variant="caption">
            {`${String(outcome.factCount)} facts, ${String(outcome.eventIds.length)} event${
              outcome.eventIds.length === 1 ? "" : "s"
            }, ${String(outcome.proposedActions)} proposed action${
              outcome.proposedActions === 1 ? "" : "s"
            }.`}
          </AppText>
          <ActionRow>
            {receiptId === undefined ? null : (
              <AppButton
                label="Open the receipt"
                onPress={() => router.push(`/inbox/${receiptId}`)}
                tone="secondary"
              />
            )}
            <AppButton label="Go to the inbox" onPress={() => router.push("/")} tone="secondary" />
          </ActionRow>
        </>
      )}

      <ReceiptStage label="Generate a capture" ordinal={1}>
        <AppText tone="muted" variant="caption">
          Each one arrives the way a real notification would. Tap to send it now.
        </AppText>
        <AppButton
          accessibilityHint="Sends five assorted captures one after another"
          disabled={busy}
          label="Send five assorted captures"
          loading={busy}
          onPress={() => void sendBurst()}
        />
        {DEMO_SCENARIOS.map((scenario) => (
          <EditorialSurface
            accessibilityHint={scenario.detail}
            icon={scenario.icon}
            key={scenario.id}
            meta="Send"
            onPress={() => void sendScenario(scenario.id)}
            title={scenario.label}
          >
            <AppText tone="muted" variant="caption">
              {scenario.detail}
            </AppText>
          </EditorialSurface>
        ))}
      </ReceiptStage>

      <ReceiptStage label="Compose your own" ordinal={2}>
        <AppText tone="muted" variant="caption">
          Anything typed here becomes a notification capture from that application. Try wording that
          one of your rules would claim, then look at the receipt to see which predicate matched.
        </AppText>
        <AppTextInput
          accessibilityLabel="Application package"
          autoCapitalize="none"
          autoCorrect={false}
          label="Application package"
          onChangeText={setApplicationId}
          value={applicationId}
        />
        <AppTextInput
          accessibilityLabel="Sender"
          label="Sender"
          onChangeText={setSender}
          value={sender}
        />
        <AppTextInput
          accessibilityLabel="Title"
          label="Title"
          onChangeText={setSubject}
          value={subject}
        />
        <AppTextInput
          accessibilityLabel="Message"
          label="Message"
          multiline
          numberOfLines={3}
          onChangeText={setBody}
          value={body}
        />
        <AppButton
          disabled={busy}
          label="Send this notification"
          loading={busy}
          onPress={() => void send(customScenarioInput({ applicationId, body, sender, subject }))}
        />
      </ReceiptStage>

      <ReceiptStage label="Start over" ordinal={3}>
        <AppText tone="muted" variant="caption">
          Restores the account this build opens on: the same categories, rules, captures and
          history, in the same order. Anything generated since is discarded.
        </AppText>
        <AppButton
          disabled={resetting}
          label="Reset the demo account"
          loading={resetting}
          onPress={() => setResetVisible(true)}
          tone="destructive"
        />
      </ReceiptStage>

      <ConfirmationDialog
        confirmLabel="Reset"
        detail="Every generated capture, decision and rule change is discarded, and the seeded account comes back exactly as it started."
        loading={resetting}
        onCancel={() => setResetVisible(false)}
        onConfirm={() => void reset()}
        title="Reset the demo account?"
        visible={resetVisible}
      />
    </ReceiptScreen>
  );
}
