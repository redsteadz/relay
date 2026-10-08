import { describe, expect, it } from "vitest";

import {
  compileSilencePlan,
  remainingWindowHours,
  reviewableRules,
  type SilenceAuthorization,
} from "./notification-silence";

const COURIER = {
  field: "source.applicationId",
  operator: "equals",
  value: "com.courier.app",
} as const;

function plan(deterministic: unknown, semantic?: unknown) {
  return {
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "synthetic intent",
    deterministic,
    ...(semantic === undefined ? {} : { semantic }),
  };
}

function rule(overrides: Partial<SilenceAuthorization> = {}): SilenceAuthorization {
  return {
    action: "snooze",
    authorized: false,
    dryRunCompletedAt: undefined,
    dryRunStartedAt: undefined,
    enabled: true,
    id: "7f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f607",
    name: "Delivery pings",
    plan: plan(COURIER),
    seriesId: "6f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f600",
    version: 1,
    ...overrides,
  };
}

function compile(rules: SilenceAuthorization[], killSwitchEngaged = false) {
  return compileSilencePlan(rules, { killSwitchEngaged, revision: 1 });
}

describe("what reaches the device", () => {
  // A rule nobody started observing is absent from the snapshot entirely. Recording decisions about
  // someone's notifications because a rule happens to exist is not something they asked for.
  it("leaves out a rule whose dry run has not started", () => {
    const result = compile([rule()]);
    expect(result.snapshot.rules).toStrictEqual([]);
    expect(result.snapshot.mode).toBe("off");
    expect(result.statuses[0]?.stage).toBe("unauthorized");
  });

  it("includes an observing rule and marks it as observing", () => {
    const result = compile([rule({ dryRunStartedAt: "2026-10-01T00:00:00.000Z" })]);
    expect(result.snapshot.rules).toHaveLength(1);
    expect(result.snapshot.rules[0]?.observing).toBe(true);
    expect(result.snapshot.mode).toBe("dry-run");
    expect(result.statuses[0]?.stage).toBe("observing");
  });

  it("marks an authorized rule as acting", () => {
    const result = compile([
      rule({
        authorized: true,
        dryRunCompletedAt: "2026-10-04T00:00:00.000Z",
        dryRunStartedAt: "2026-10-01T00:00:00.000Z",
      }),
    ]);
    expect(result.snapshot.rules[0]?.observing).toBe(false);
    expect(result.snapshot.mode).toBe("enforcing");
    expect(result.statuses[0]?.stage).toBe("acting");
  });

  // One rule reaching the end of its window must not drag another out of its own, which is why the
  // flag is per rule and the mode is only a summary.
  it("carries an observing rule and an authorized rule together", () => {
    const result = compile([
      rule({ dryRunStartedAt: "2026-10-01T00:00:00.000Z" }),
      rule({
        authorized: true,
        dryRunCompletedAt: "2026-10-04T00:00:00.000Z",
        dryRunStartedAt: "2026-10-01T00:00:00.000Z",
        id: "8f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f608",
        name: "Promos",
        seriesId: "9f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f609",
      }),
    ]);
    // Ordered by rule name, so the observing "Delivery pings" precedes the authorized "Promos".
    expect(result.snapshot.rules.map((entry) => entry.observing)).toStrictEqual([true, false]);
    expect(result.snapshot.mode).toBe("enforcing");
  });

  // A disabled rule authorizes nothing even if the database still says it may act, because a rule
  // that is not filing anything has no current evidence behind it.
  it("leaves out a disabled rule", () => {
    const result = compile([
      rule({
        authorized: true,
        dryRunCompletedAt: "2026-10-04T00:00:00.000Z",
        dryRunStartedAt: "2026-10-01T00:00:00.000Z",
        enabled: false,
      }),
    ]);
    expect(result.snapshot.rules).toStrictEqual([]);
    expect(result.statuses[0]?.stage).toBe("unauthorized");
  });

  // An edit writes a new revision with authorization withdrawn. The evidence a person reviewed was
  // evidence about the rule as it was written then, so only the newest revision is considered.
  it("considers only the newest revision of a series", () => {
    const result = compile([
      rule({
        authorized: true,
        dryRunCompletedAt: "2026-10-04T00:00:00.000Z",
        dryRunStartedAt: "2026-10-01T00:00:00.000Z",
        id: "1f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f601",
        version: 1,
      }),
      rule({ id: "2f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f602", version: 2 }),
    ]);
    expect(result.snapshot.rules).toStrictEqual([]);
    expect(result.statuses).toHaveLength(1);
    expect(result.statuses[0]?.rule.version).toBe(2);
  });

  it("carries the kill switch into the snapshot", () => {
    const result = compile([rule({ dryRunStartedAt: "2026-10-01T00:00:00.000Z" })], true);
    expect(result.snapshot.killSwitchEngaged).toBe(true);
  });

  // The action is the difference between a two-hour delay and a notification nobody sees again, so
  // it has to be the rule's own rather than a default chosen here.
  it("carries each rule's own action", () => {
    const result = compile([
      rule({ action: "dismiss", dryRunStartedAt: "2026-10-01T00:00:00.000Z" }),
    ]);
    expect(result.snapshot.rules[0]?.action).toBe("dismiss");
  });
});

describe("a rule that asks a model", () => {
  const SEMANTIC = { allowedFields: ["subject"], minimumConfidence: 0.8, question: "urgent?" };

  // It used to be refused outright. The device can reach an endpoint its reader configured, so the
  // rule compiles and carries the flag that says it may not act until a model has answered.
  it("compiles, marked as owing a model an answer", () => {
    const result = compile([
      rule({ dryRunStartedAt: "2026-10-01T00:00:00.000Z", plan: plan(COURIER, SEMANTIC) }),
    ]);
    expect(result.statuses[0]?.stage).toBe("observing");
    expect(result.snapshot.rules).toHaveLength(1);
    expect(result.snapshot.rules[0]?.awaitsModel).toBe(true);
  });

  // The literal tests still reach the device. They are what the listener evaluates before anything
  // is a candidate, so they are also what bounds how often a model is asked anything.
  it("keeps the deterministic tests the listener evaluates first", () => {
    const result = compile([
      rule({ dryRunStartedAt: "2026-10-01T00:00:00.000Z", plan: plan(COURIER, SEMANTIC) }),
    ]);
    expect(result.snapshot.rules[0]?.clauses).toStrictEqual([
      {
        tests: [{ field: "source.applicationId", operator: "equals", values: ["com.courier.app"] }],
      },
    ]);
  });

  it("marks a purely deterministic rule as owing nothing", () => {
    const result = compile([rule({ dryRunStartedAt: "2026-10-01T00:00:00.000Z" })]);
    expect(result.snapshot.rules[0]?.awaitsModel).toBe(false);
  });
});

describe("what the device is told it cannot evaluate", () => {
  it.each([
    [
      "a rule naming no application",
      plan({ field: "subject", operator: "contains", value: "delivery" }),
      "unbounded-application",
    ],
    [
      "a category predicate",
      plan({ all: [COURIER, { field: "category", operator: "equals", value: "finance" }] }),
      "unreadable-field",
    ],
    [
      "a negated predicate",
      plan({ all: [COURIER, { not: { field: "subject", operator: "exists" } }] }),
      "negation-unsupported",
    ],
    // A rule that is only a model's judgement would hand the scope to the model, which is the
    // ordering ADR-0003 forbids. Refused here, and by `dismissible_filter_rule` in the database.
    [
      "a plan with no deterministic part",
      {
        allowedFields: ["subject"],
        compilerVersion: 1,
        intent: "synthetic intent",
        minimumConfidence: 0.8,
        schemaVersion: 1,
      },
      "no-deterministic-clause",
    ],
  ])("refuses %s", (_label, refusedPlan, refusal) => {
    const result = compile([
      rule({ dryRunStartedAt: "2026-10-01T00:00:00.000Z", plan: refusedPlan }),
    ]);
    expect(result.snapshot.rules).toStrictEqual([]);
    expect(result.statuses[0]?.stage).toBe("refused");
    expect(result.statuses[0]?.refusal).toBe(refusal);
  });

  // The bug this replaced: a rule that can never be authorized was classified by whether anyone had
  // started watching it, which happened before compilation. It therefore reported as merely "not
  // started", the screen offered a live "start watching" control, and the database refused the write
  // on plan shape -- discarding the reason this function could already name.
  it("refuses an unevaluable rule even when no dry run has started", () => {
    const result = compile([
      rule({ plan: plan({ field: "subject", operator: "contains", value: "delivery" }) }),
    ]);
    expect(result.statuses[0]?.stage).toBe("refused");
    expect(result.statuses[0]?.refusal).toBe("unbounded-application");
    expect(result.snapshot.rules).toStrictEqual([]);
  });

  // The same, for a rule that is switched off: being disabled must not mask that the rule could
  // never act anyway.
  it("refuses an unevaluable rule that is also switched off", () => {
    const result = compile([
      rule({
        enabled: false,
        plan: plan({ all: [COURIER, { field: "category", operator: "equals", value: "finance" }] }),
      }),
    ]);
    expect(result.statuses[0]?.stage).toBe("refused");
    expect(result.statuses[0]?.refusal).toBe("unreadable-field");
  });

  // A rule that compiles but has no window yet keeps its compiled form, so the apps it names can
  // still be offered Android's own per-app settings, while staying out of the snapshot.
  it("keeps the compiled form of a rule nobody is watching yet", () => {
    const result = compile([rule()]);
    expect(result.statuses[0]?.stage).toBe("unauthorized");
    expect(result.statuses[0]?.compiled?.clauses).toHaveLength(1);
    expect(result.snapshot.rules).toStrictEqual([]);
  });

  // A plan that no longer satisfies the wire contract is refused rather than guessed at. It can only
  // arise from a stored plan written by an older compiler, and acting on a plan this build cannot
  // parse would be acting on something nobody wrote.
  it("refuses a plan that does not satisfy the contract", () => {
    const result = compile([
      rule({ dryRunStartedAt: "2026-10-01T00:00:00.000Z", plan: { schemaVersion: 99 } }),
    ]);
    expect(result.statuses[0]?.stage).toBe("refused");
    expect(result.statuses[0]?.refusal).toBe("no-deterministic-clause");
  });
});

describe("the observation window", () => {
  const started = "2026-10-01T00:00:00.000Z";
  const startedAt = Date.parse(started);

  it("reports the whole window before anything has been observed", () => {
    expect(remainingWindowHours(undefined, 72, startedAt)).toBe(72);
  });

  it("counts down in whole hours", () => {
    expect(remainingWindowHours(started, 72, startedAt + 24 * 3_600_000)).toBe(48);
    expect(remainingWindowHours(started, 72, startedAt + 71.5 * 3_600_000)).toBe(1);
  });

  it("never goes below zero", () => {
    expect(remainingWindowHours(started, 72, startedAt + 500 * 3_600_000)).toBe(0);
  });

  // An unparseable timestamp reports the full window rather than zero, so a bad value delays the
  // review instead of unlocking it.
  it("reports the whole window for an unreadable timestamp", () => {
    expect(remainingWindowHours("not a date", 72, startedAt)).toBe(72);
  });

  it("lists only rules whose window the server has closed", () => {
    const observing = compile([rule({ dryRunStartedAt: started })]).statuses;
    expect(reviewableRules(observing)).toStrictEqual([]);

    const closed = compile([
      rule({ dryRunCompletedAt: "2026-10-04T00:00:00.000Z", dryRunStartedAt: started }),
    ]).statuses;
    expect(reviewableRules(closed)).toHaveLength(1);
  });
});
