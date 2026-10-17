/**
 * Why quieting is or is not deciding anything, in one list of facts.
 *
 * Built because the chain between a notification arriving and a rule deciding has six stages, any
 * of which can stop it, and five of them used to leave no evidence at all. A reader watching a rule
 * never decide had the same view whether the listener was unbound, the snapshot was off, the stop
 * was engaged, the candidate had left the shade, the rule had been edited into a new revision, the
 * device no longer held the notification's text, or the model was refusing every request. Native
 * diagnostics exist but log under `BuildConfig.DEBUG`, which is false in the builds this is
 * actually sideloaded as, so they report to nobody.
 *
 * Every line is a count, a mode or a boolean. Nothing here names a notification, an application or
 * a rule, so the panel discloses nothing the quiet ledger does not already hold.
 */

import type { DeviceSemanticConfig } from "@relay/contracts";

import type { NativeSilenceDiagnostics } from "@/modules/relay-device-ingress";

import type { QuietPassReport } from "../api/silenceResolution";

export type DiagnosticLine = {
  /** What to do about it, when there is something. */
  detail?: string;
  label: string;
  /** False marks the stage that is stopping the chain, so the panel can point at it. */
  ok: boolean;
  value: string;
};

const STAGE_DETAIL: Record<QuietPassReport["stage"], string> = {
  "no-candidates":
    "Nothing is waiting. Either no notification has matched a rule that asks a model, or the ones that did are no longer on screen.",
  "no-model": "Candidates are waiting, but this phone has no model configured to ask.",
  "no-store": "This device has no local store, so a disclosure could not be recorded.",
  ran: "The pass ran against every candidate it was given.",
};

const SKIP_DETAIL: Record<string, string> = {
  "content-missing":
    "Relay no longer holds what those notifications said, so there is nothing to judge.",
  "rule-missing":
    "The rule behind those candidates is not in this pass's view -- usually because it was edited, which makes a new revision and leaves the old candidates orphaned.",
  undecided: "A request was made and the model did not answer. The verdict rows above say why.",
};

/**
 * The chain, in the order it runs.
 *
 * Ordered deliberately: the first failing line is the one to fix, and everything below it is a
 * consequence rather than a second problem.
 */
export function quietDiagnosticLines(
  native: NativeSilenceDiagnostics | undefined,
  config: DeviceSemanticConfig | undefined,
  pass: QuietPassReport | undefined,
): DiagnosticLine[] {
  const lines: DiagnosticLine[] = [];

  if (native === undefined) {
    lines.push({
      detail: "Quieting needs the Android notification listener, which only a device build has.",
      label: "Device",
      ok: false,
      value: "not an Android device build",
    });
    return lines;
  }

  lines.push({
    ...(native.listenerBound
      ? {}
      : {
          detail:
            "Android has not bound Relay's listener. Nothing can be read from the shade and nothing can be cleared. Re-granting notification access in Android settings rebinds it.",
        }),
    label: "Notification listener",
    ok: native.listenerBound,
    value: native.listenerBound ? "bound" : "not bound",
  });

  lines.push({
    ...(native.mode === "off"
      ? { detail: "No rule is authorized or under observation, so the listener does nothing." }
      : {}),
    label: "Quiet mode",
    ok: native.mode !== "off",
    value: `${native.mode} (${String(native.ruleCount)} rule${native.ruleCount === 1 ? "" : "s"})`,
  });

  if (native.killSwitchEngaged) {
    lines.push({
      detail: "Everything below is held back until the stop is released.",
      label: "Stop",
      ok: false,
      value: "engaged",
    });
  }

  lines.push({
    ...(config === undefined
      ? { detail: "No endpoint is saved on this phone, so no clause can be decided here." }
      : {}),
    label: "Model on this phone",
    ok: config !== undefined,
    value:
      config === undefined
        ? "none"
        : `${config.protocol === "system-one" ? "decision engine" : "chat model"} - ${config.model}`,
  });

  lines.push({
    ...(native.awaitingModelCount === 0
      ? {
          detail:
            "No notification has been recorded as waiting on a model. If a rule should have matched one, the rule is not matching rather than the model not answering.",
        }
      : {}),
    label: "Waiting on a model",
    ok: native.awaitingModelCount > 0,
    value: String(native.awaitingModelCount),
  });

  if (native.awaitingModelCount > 0) {
    const stale = native.awaitingModelCount - Math.max(native.actionableCount, 0);
    lines.push({
      ...(native.actionableCount === 0
        ? {
            detail:
              "Every waiting notification has left the shade, so there is nothing left to clear and no request is worth making. Quieting only acts on a notification that is still on screen -- test with a fresh one.",
          }
        : stale > 0
          ? { detail: `${String(stale)} have left the shade and will be closed as already gone.` }
          : {}),
      label: "Still on screen",
      ok: native.actionableCount > 0,
      value: native.actionableCount < 0 ? "unknown" : String(native.actionableCount),
    });
  }

  if (pass !== undefined) {
    lines.push({
      detail: STAGE_DETAIL[pass.stage],
      label: "Last pass",
      ok: pass.stage === "ran",
      value: `${pass.stage}, asked ${String(pass.evaluated)} of ${String(pass.candidates)}`,
    });

    for (const [reason, count] of Object.entries(pass.skipped)) {
      lines.push({
        ...(SKIP_DETAIL[reason] === undefined ? {} : { detail: SKIP_DETAIL[reason] }),
        label: `Passed over: ${reason}`,
        ok: false,
        value: String(count),
      });
    }

    for (const [decision, count] of Object.entries(pass.decided)) {
      lines.push({ label: `Decided: ${decision}`, ok: true, value: String(count) });
    }
  }

  return lines;
}

/** The one line a reader should act on: the first stage that is stopping the chain. */
export function firstBlockingLine(lines: readonly DiagnosticLine[]): DiagnosticLine | undefined {
  return lines.find((line) => !line.ok);
}
