import { describe, expect, it } from "vitest";

import type { NativeSilenceDiagnostics } from "@/modules/relay-device-ingress";

import type { QuietPassReport } from "../api/silenceResolution";
import { firstBlockingLine, quietDiagnosticLines } from "./quietDiagnostics";

const HEALTHY: NativeSilenceDiagnostics = {
  actionableCount: 2,
  awaitingModelCount: 2,
  killSwitchEngaged: false,
  listenerBound: true,
  mode: "enforcing",
  postedCount: 9,
  ruleCount: 1,
};

const MODEL = {
  baseUrl: "https://openrouter.ai/api/v1",
  model: "typesafe/jev-1.14",
  protocol: "system-one" as const,
  responseFormat: "json-object" as const,
};

function labels(lines: readonly { label: string }[]): string[] {
  return lines.map((line) => line.label);
}

describe("why quieting is or is not deciding", () => {
  it("reports every stage ready when it is", () => {
    const lines = quietDiagnosticLines(HEALTHY, MODEL, undefined);
    expect(firstBlockingLine(lines)).toBeUndefined();
  });

  /*
    The three reasons `getPendingNotificationSilences` returns nothing are indistinguishable to its
    caller, which is what made this impossible to debug from the outside. Each has to surface as
    its own blocking line.
  */
  it("separates an unbound listener from an off snapshot from an engaged stop", () => {
    expect(
      firstBlockingLine(
        quietDiagnosticLines({ ...HEALTHY, listenerBound: false }, MODEL, undefined),
      )?.label,
    ).toBe("Notification listener");
    expect(
      firstBlockingLine(quietDiagnosticLines({ ...HEALTHY, mode: "off" }, MODEL, undefined))?.label,
    ).toBe("Quiet mode");
    expect(
      firstBlockingLine(
        quietDiagnosticLines({ ...HEALTHY, killSwitchEngaged: true }, MODEL, undefined),
      )?.label,
    ).toBe("Stop");
  });

  it("names a missing model before blaming anything downstream", () => {
    const lines = quietDiagnosticLines(HEALTHY, undefined, undefined);
    expect(firstBlockingLine(lines)?.label).toBe("Model on this phone");
  });

  // The case that quietly wasted every pass: candidates exist but none is still on screen.
  it("distinguishes nothing waiting from nothing still on screen", () => {
    const none = quietDiagnosticLines(
      { ...HEALTHY, actionableCount: 0, awaitingModelCount: 0 },
      MODEL,
      undefined,
    );
    expect(firstBlockingLine(none)?.label).toBe("Waiting on a model");

    const stale = quietDiagnosticLines(
      { ...HEALTHY, actionableCount: 0, awaitingModelCount: 3 },
      MODEL,
      undefined,
    );
    expect(firstBlockingLine(stale)?.label).toBe("Still on screen");
    expect(firstBlockingLine(stale)?.detail).toContain("fresh one");
  });

  // An unreadable shade is not an empty one, and must not read as a count of zero.
  it("says unknown rather than zero when the shade could not be read", () => {
    const lines = quietDiagnosticLines(
      { ...HEALTHY, actionableCount: -1, listenerBound: false, postedCount: -1 },
      MODEL,
      undefined,
    );
    expect(lines.find((line) => line.label === "Still on screen")?.value).toBe("unknown");
  });

  it("reports which stage a pass stopped at", () => {
    const pass: QuietPassReport = {
      acted: 0,
      candidates: 2,
      decided: {},
      evaluated: 0,
      skipped: {},
      stage: "no-model",
    };
    const lines = quietDiagnosticLines(HEALTHY, MODEL, pass);
    expect(lines.find((line) => line.label === "Last pass")?.ok).toBe(false);
  });

  // A pass that ran and asked nothing is the case that used to report the bare number 0.
  it("breaks down what a pass passed over, and why", () => {
    const pass: QuietPassReport = {
      acted: 0,
      candidates: 3,
      decided: { snoozed: 1 },
      evaluated: 1,
      skipped: { "rule-missing": 2 },
      stage: "ran",
    };
    const lines = quietDiagnosticLines(HEALTHY, MODEL, pass);
    expect(labels(lines)).toContain("Passed over: rule-missing");
    expect(labels(lines)).toContain("Decided: snoozed");
    expect(lines.find((line) => line.label === "Passed over: rule-missing")?.detail).toContain(
      "edited",
    );
  });

  it("says plainly when this is not a device build", () => {
    const lines = quietDiagnosticLines(undefined, MODEL, undefined);
    expect(lines).toHaveLength(1);
    expect(firstBlockingLine(lines)?.label).toBe("Device");
  });
});
