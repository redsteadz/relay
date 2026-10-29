import { describe, expect, it } from "vitest";

import type { DeviceModelPassReport } from "@/lib/device-semantic-diagnostics";
import type { DeviceCapabilities } from "@/modules/relay-device-ingress";

import {
  attemptExplanation,
  attemptLine,
  disclosureLine,
  formatAgo,
  formatDuration,
  listenerStateLine,
  passOutcomeExplanation,
  passPillLabel,
  passTone,
} from "./deviceModelDiagnosticsPresentation";

function report(overrides: Partial<DeviceModelPassReport> = {}): DeviceModelPassReport {
  return {
    attempts: [],
    counts: {
      acted: 0,
      candidates: 0,
      evaluated: 0,
      skippedNoContent: 0,
      skippedRuleGone: 0,
      undecided: 0,
    },
    durationMs: 40,
    kind: "quiet",
    outcome: "no-candidates",
    startedAt: "2026-10-23T10:00:00.000Z",
    trigger: "foreground",
    ...overrides,
  };
}

function capabilities(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    buildVariant: "development",
    notificationAllowedPackages: [],
    notificationCapturePaused: false,
    notificationListener: true,
    notificationListenerBound: true,
    notificationSilenceKillSwitch: false,
    notificationSilenceMode: "enforcing",
    notificationSilencePendingCount: 0,
    notificationSilenceRevision: 1,
    notificationSilenceRuleCount: 1,
    platform: "android",
    smsAllowedSenders: [],
    smsAvailable: false,
    smsCapturePaused: true,
    smsPermissionGranted: false,
    smsQueuedCount: 0,
    ...overrides,
  };
}

describe("why a pass stopped", () => {
  // The case this page exists for. It looks exactly like a slow model from every other surface.
  it("names an unbound listener and says what to do about it", () => {
    const text = passOutcomeExplanation(
      report({
        counts: { ...report().counts, candidates: 4 },
        outcome: "shade-unreadable",
      }),
    );
    expect(text).toContain("4 notifications are waiting");
    expect(text).toContain("not connected");
    expect(text).toContain("off and on again");
    expect(passPillLabel(report({ outcome: "shade-unreadable" }))).toBe("Listener off");
    expect(passTone(report({ outcome: "shade-unreadable" }))).toBe("warning");
  });

  it("says when candidates were skipped and why, even when none was asked", () => {
    const text = passOutcomeExplanation(
      report({
        counts: { ...report().counts, candidates: 2, skippedNoContent: 1, skippedRuleGone: 1 },
        outcome: "evaluated",
      }),
    );
    expect(text).toContain("1 notification whose retained text has expired");
    expect(text).toContain("edited or paused");
    expect(passPillLabel(report({ outcome: "evaluated" }))).toBe("Nothing asked");
  });

  it("counts what was asked, acted on and left undecided", () => {
    const text = passOutcomeExplanation(
      report({
        counts: { ...report().counts, acted: 1, candidates: 3, evaluated: 3, undecided: 2 },
        outcome: "evaluated",
      }),
    );
    expect(text).toContain("Asked your model 3 times");
    expect(text).toContain("1 notification put away or cleared");
    expect(text).toContain("2 got no usable answer");
  });

  it("reads a pass with a refused attempt as a warning", () => {
    const refused = report({
      attempts: [{ decision: "undecided", durationMs: 10, refusal: "rejected", statusCode: 401 }],
      counts: { ...report().counts, candidates: 1, evaluated: 1, undecided: 1 },
      outcome: "evaluated",
    });
    expect(passTone(refused)).toBe("warning");
    expect(passPillLabel(refused)).toBe("Asked, refused");
  });
});

describe("one attempt as a line", () => {
  it("says where it went, how long it took, and the status it got", () => {
    const line = attemptLine({
      decision: "undecided",
      durationMs: 1_250,
      host: "api.typesafe.ai",
      model: "jev-latest",
      protocol: "system-one",
      refusal: "rejected",
      statusCode: 401,
    });
    expect(line).toBe(
      "Sent to jev-latest at api.typesafe.ai as a decision engine · 1.3 s · HTTP 401 · rejected",
    );
  });

  it("explains a 404 as an address problem rather than a key problem", () => {
    const text = attemptExplanation({
      decision: "undecided",
      durationMs: 10,
      refusal: "rejected",
      statusCode: 404,
    });
    expect(text).toContain("no route at that address");
    expect(text).toContain("/systemone");
  });

  it("says nothing was sent when nothing was", () => {
    expect(
      attemptLine({ decision: "undecided", durationMs: 1, refusal: "not-configured" }),
    ).toContain("Nothing was sent");
  });
});

describe("the live listener line", () => {
  it("distinguishes granted-but-unbound from not granted", () => {
    expect(listenerStateLine(capabilities({ notificationListener: false })).detail).toContain(
      "not granted",
    );
    const unbound = listenerStateLine(capabilities({ notificationListenerBound: false }));
    expect(unbound.detail).toContain("not connected");
    expect(unbound.tone).toBe("warning");
  });

  // An older native build cannot report the binding. Saying "off" would send a reader to fix a
  // listener that may be fine.
  it("says when this build cannot tell", () => {
    const older: DeviceCapabilities = { ...capabilities() };
    delete older.notificationListenerBound;
    const { detail, tone } = listenerStateLine(older);
    expect(detail).toContain("cannot tell");
    expect(tone).toBe("muted");
  });

  it("counts what is waiting when the listener is connected", () => {
    expect(
      listenerStateLine(capabilities({ notificationSilencePendingCount: 2 })).detail,
    ).toContain("2 notifications are waiting");
  });
});

describe("formatting", () => {
  it("formats durations and elapsed time in readable units", () => {
    expect(formatDuration(80)).toBe("80 ms");
    expect(formatDuration(2_400)).toBe("2.4 s");
    const now = Date.parse("2026-10-23T12:00:00.000Z");
    expect(formatAgo("2026-10-23T11:59:50.000Z", now)).toBe("just now");
    expect(formatAgo("2026-10-23T11:45:00.000Z", now)).toBe("15 minutes ago");
    expect(formatAgo("2026-10-23T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(formatAgo("2026-10-20T12:00:00.000Z", now)).toBe("3 days ago");
    expect(formatAgo("not a date", now)).toBe("at an unknown time");
  });

  it("describes a disclosure row without any content", () => {
    expect(
      disclosureLine({
        created_at: "2026-10-23T10:00:00.000Z",
        decision: "undecided",
        disclosed: 1,
        disclosed_fields: '["subject"]',
        endpoint_host: "192.168.1.10",
        failure_reason: "timed-out",
        filter_rule_id: null,
        id: "d1",
        model: "llama3.2:3b",
        provider: "openai",
        purpose: "filter-evaluation",
        redactions: "[]",
        source_item_id: "s1",
      }),
    ).toBe("llama3.2:3b at 192.168.1.10 · timed-out");
  });
});
