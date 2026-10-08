import type { NotificationSilenceOutcome } from "@relay/contracts";
import { describe, expect, it } from "vitest";

import type { SilenceAuthorization, SilenceRuleStatus } from "@/lib/notification-silence";

import {
  capabilityNotice,
  decisionLabel,
  decisionTone,
  namedApplications,
  reviewSummary,
  silenceRuleRow,
} from "./silencePresentation";

const RULE_ID = "7f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f607";

function authorization(overrides: Partial<SilenceAuthorization> = {}): SilenceAuthorization {
  return {
    action: "snooze",
    authorized: false,
    dryRunCompletedAt: undefined,
    dryRunStartedAt: undefined,
    enabled: true,
    id: RULE_ID,
    name: "Delivery pings",
    plan: {},
    seriesId: "6f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f600",
    version: 1,
    ...overrides,
  };
}

function status(
  stage: SilenceRuleStatus["stage"],
  overrides: Partial<SilenceAuthorization> = {},
  refusal?: SilenceRuleStatus["refusal"],
): SilenceRuleStatus {
  return {
    rule: authorization(overrides),
    stage,
    ...(refusal === undefined ? {} : { refusal }),
  };
}

function row(
  stage: SilenceRuleStatus["stage"],
  options: {
    awaitsModel?: boolean;
    killSwitchEngaged?: boolean;
    modelConfigured?: boolean;
    refusal?: SilenceRuleStatus["refusal"];
    remainingHours?: number;
    rule?: Partial<SilenceAuthorization>;
    unscoped?: boolean;
  } = {},
) {
  const base = status(stage, options.rule ?? {}, options.refusal);
  const unscoped = options.unscoped ?? false;
  return silenceRuleRow(
    options.awaitsModel === undefined && !unscoped
      ? base
      : {
          ...base,
          compiled: {
            action: base.rule.action,
            // An unscoped rule is only ever decidable by a model, which the contract enforces.
            awaitsModel: unscoped ? true : (options.awaitsModel ?? false),
            clauses: unscoped
              ? []
              : [
                  {
                    tests: [
                      {
                        field: "source.applicationId",
                        operator: "equals",
                        values: ["com.courier.app"],
                      },
                    ],
                  },
                ],
            filterRuleId: base.rule.id,
            observing: stage === "observing",
            unscoped,
          },
        },
    {
      killSwitchEngaged: options.killSwitchEngaged ?? false,
      modelConfigured: options.modelConfigured ?? true,
      remainingHours: options.remainingHours ?? 72,
    },
  );
}

describe("the control a row offers", () => {
  it("offers watching for a rule that has not started", () => {
    expect(row("unauthorized").action).toBe("observe");
  });

  it("offers nothing for a switched-off rule", () => {
    const result = row("unauthorized", { rule: { enabled: false } });
    expect(result.action).toBeUndefined();
    expect(result.detail).toContain("switched off");
  });

  // Offering a review before the database will accept one is worse than offering none: the button
  // exists, the person presses it, and the routine refuses.
  it("offers nothing mid-window and a review once it has elapsed", () => {
    expect(row("observing", { remainingHours: 40 }).action).toBeUndefined();
    expect(row("observing", { remainingHours: 0 }).action).toBe("review");
  });

  it("treats a server-closed window as reviewable whatever the clock says", () => {
    const result = row("observing", {
      remainingHours: 40,
      rule: { dryRunCompletedAt: "2026-10-04T00:00:00.000Z" },
    });
    expect(result.action).toBe("review");
  });

  it("offers a withdrawal for an acting rule", () => {
    expect(row("acting").action).toBe("withdraw");
  });

  it("offers nothing for a rule the device cannot evaluate", () => {
    const result = row("refused", { refusal: "unreadable-field" });
    expect(result.action).toBeUndefined();
    expect(result.pill.label).toBe("Cannot clear");
  });
});

describe("what a row says", () => {
  // Mid-window the one thing a person wants is how long is left, so it is a number rather than
  // "soon", and nothing on the row may suggest the rule is already doing something.
  it("states the hours left and that nothing is being changed", () => {
    const result = row("observing", { remainingHours: 40 });
    expect(result.detail).toContain("40 hours left");
    expect(result.detail).toContain("Nothing is being changed");
  });

  it("uses the singular for the last hour", () => {
    expect(row("observing", { remainingHours: 1 }).detail).toContain("1 hour left");
  });

  // An acting rule under the kill switch is not acting. Showing it as "Quieting" would make the stop
  // look like it had not worked.
  it("shows an acting rule as stopped while the kill switch is engaged", () => {
    const result = row("acting", { killSwitchEngaged: true });
    expect(result.pill).toStrictEqual({ label: "Stopped", tone: "warning" });
    expect(result.detail).toContain("stopped right now");
  });

  // The two things a person could get wrong about an acting rule: that the notification is gone
  // from Relay too, and that their phone stopped making a sound. Both are stated, not implied.
  it("says the notification stays in Relay and the phone still sounds", () => {
    const result = row("acting");
    expect(result.detail).toContain("stay in Relay");
    expect(result.detail).toContain("still makes its sound");
  });

  // A person who authorized a snooze and reads a sentence about clearing for good has been told
  // their notifications are gone when they are not. The reverse is worse.
  it("never describes a snooze as a cancellation or the other way round", () => {
    const snoozing = row("acting", { rule: { action: "snooze" } });
    expect(snoozing.pill.label).toBe("Putting away");
    expect(snoozing.detail).toContain("brings them back");
    expect(snoozing.detail).not.toContain("for good");

    const dismissing = row("acting", { rule: { action: "dismiss" } });
    expect(dismissing.pill.label).toBe("Clearing");
    expect(dismissing.detail).toContain("for good");
    expect(dismissing.detail).toContain("Nothing brings them back");
  });

  // A rule that asks a model acts on the next pass, not as the notification arrives, and the copy
  // must not promise a speed it cannot deliver.
  it("says a rule asking a model acts a few minutes later", () => {
    const deferred = row("acting", { awaitsModel: true, rule: { action: "snooze" } });
    expect(deferred.detail).toContain("a few minutes after they arrive");
    expect(deferred.detail).not.toContain("put away for two hours once they arrive");

    const immediate = row("acting", { awaitsModel: false, rule: { action: "snooze" } });
    expect(immediate.detail).toContain("once they arrive");
    expect(immediate.detail).not.toContain("a few minutes");
  });

  // Authorizing such a rule with no endpoint configured would otherwise read as working. The screen
  // must not make a promise the device cannot keep.
  it("says plainly when a rule asks a model this phone does not have", () => {
    const result = row("acting", { awaitsModel: true, modelConfigured: false });
    expect(result.pill.label).toBe("Waiting on a model");
    expect(result.detail).toContain("no model is set up");
    expect(result.detail).toContain("Your data");
  });

  // The stop outranks it. A reader who stopped everything is told that, not told to go configure a
  // model for a rule that could not act anyway.
  it("reports the stop ahead of a missing model", () => {
    const result = row("acting", {
      awaitsModel: true,
      killSwitchEngaged: true,
      modelConfigured: false,
    });
    expect(result.pill.label).toBe("Stopped");
  });

  it("says an observing rule records nothing without the model it asks", () => {
    const result = row("observing", {
      awaitsModel: true,
      modelConfigured: false,
      remainingHours: 40,
    });
    expect(result.detail).toContain("record nothing");
    expect(result.detail).not.toContain("40 hours left");
  });

  // The difference between "cleared in one app" and "cleared everywhere" is the single most
  // important thing on the row, and not something to leave a reader to infer from an absence.
  it("says when a rule reaches every captured notification", () => {
    const everywhere = row("acting", { unscoped: true });
    expect(everywhere.detail).toContain("Every notification Relay captures");

    const narrowed = row("acting", { awaitsModel: true });
    expect(narrowed.detail).not.toContain("Every notification Relay captures");
  });

  it("explains a refusal in terms of the rule", () => {
    expect(row("refused", { refusal: "unreadable-field" }).detail).toContain("does not exist yet");
    // Names what to change rather than reporting that the phone cannot cope. A rule compiled from a
    // purely descriptive intent carries no deterministic part at all, which is the common way to
    // land here.
    const describing = row("refused", { refusal: "no-deterministic-clause" }).detail;
    expect(describing).toContain("nothing to decide with");

    // A different situation with different advice: reword nothing, rebuild the rule.
    expect(row("refused", { refusal: "unreadable-plan" }).detail).toContain("save it again");
  });
});

describe("the review evidence", () => {
  function outcome(envelopeId: string, filterRuleId?: string): NotificationSilenceOutcome {
    return {
      applicationId: "com.courier.app",
      decidedAt: "2026-10-04T00:00:00.000Z",
      decision: filterRuleId === undefined ? "no-match" : "would-snooze",
      envelopeId,
      ...(filterRuleId === undefined ? {} : { filterRuleId }),
    };
  }

  // The misses are the point of the review. A rule that matched everything from an app is a
  // different rule than the person thought they wrote, and only the miss count shows it.
  it("counts matches and misses against everything observed", () => {
    const outcomes = [
      outcome("0f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f001", RULE_ID),
      outcome("0f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f002", RULE_ID),
      outcome("0f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f003"),
    ];
    expect(reviewSummary(outcomes, RULE_ID)).toStrictEqual({
      matched: 2,
      missed: 1,
      observed: 3,
    });
  });

  it("reports an empty window as nothing observed", () => {
    expect(reviewSummary([], RULE_ID)).toStrictEqual({ matched: 0, missed: 0, observed: 0 });
  });

  // A dry-run verdict must never read as though something happened to the notification.
  it("distinguishes a would-be decision from a real one", () => {
    expect(decisionLabel("would-snooze")).toContain("Would have");
    expect(decisionLabel("snoozed")).not.toContain("Would");
    expect(decisionLabel("declined")).toContain("not acted on");
  });

  // Cancelling cannot be undone and snoozing can, so the two verdicts never read alike.
  it("keeps cancelling distinct from snoozing", () => {
    expect(decisionLabel("dismissed")).toContain("for good");
    expect(decisionLabel("snoozed")).not.toContain("for good");
    expect(decisionTone("dismissed")).not.toBe(decisionTone("snoozed"));
  });
});

describe("what Relay can actually do", () => {
  it("asks for notification access first", () => {
    const notice = capabilityNotice({ notificationListener: false });
    expect(notice.tone).toBe("warning");
    expect(notice.detail).toContain("notification access");
  });

  // The single most important string in the feature. Relay is told about a notification only after
  // the phone has alerted, so a screen that implied it could keep a phone quiet would be selling the
  // one thing this cannot deliver.
  it("says Relay cannot stop the sound, and where the switch that can lives", () => {
    const notice = capabilityNotice({ notificationListener: true });
    expect(notice.detail).toContain("already made its sound");
    expect(notice.detail).toContain("its own notification settings");
    expect(notice.detail).not.toContain("without a sound");
  });
});

describe("the apps a person can silence themselves", () => {
  function compiledStatus(filterRuleId: string, ...applications: string[]): SilenceRuleStatus {
    return {
      compiled: {
        action: "snooze",
        clauses: [
          {
            tests: [
              { field: "source.applicationId", operator: "in", values: applications },
              { field: "subject", operator: "contains", values: ["delivery"] },
            ],
          },
        ],
        awaitsModel: false,
        filterRuleId,
        observing: false,
        unscoped: false,
      },
      rule: authorization({ id: filterRuleId }),
      stage: "acting",
    };
  }

  it("lists every application a compiled rule names, once, in order", () => {
    const statuses = [
      compiledStatus(RULE_ID, "com.courier.app", "com.other.app"),
      compiledStatus("8f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f608", "com.courier.app"),
    ];
    expect(namedApplications(statuses)).toStrictEqual(["com.courier.app", "com.other.app"]);
  });

  // A rule the device refused compiles to nothing, so it names no app a person could be sent to
  // silence on its behalf.
  it("lists nothing for a rule that did not compile", () => {
    expect(namedApplications([status("refused", {}, "unreadable-field")])).toStrictEqual([]);
  });
});
