import type { PrivacyDisclosure } from "@relay/contracts";
import { describe, expect, it } from "vitest";

import {
  actionProviderLabel,
  actionStatusLabel,
  activityErrorMessage,
  activityTimeline,
  isAwaitingDecision,
  pendingDecisionCount,
  type ActionRuleInput,
  type ActionRunInput,
  type ActivityEventInput,
} from "./activityPresentation";

// Fixed instants, never compared against the clock: these fixtures assert relative order between
// stored values, so they cannot expire the way a deadline fixture would.
const EARLIER = "2026-09-01T09:00:00.000Z";
const LATER = "2026-09-02T09:00:00.000Z";

function run(overrides: Partial<ActionRunInput> = {}): ActionRunInput {
  return {
    actionRuleId: "rule-1",
    approvedAt: null,
    attemptCount: 0,
    completedAt: null,
    createdAt: EARLIER,
    errorCode: null,
    eventId: "event-1",
    id: "run-1",
    provider: "google-tasks",
    status: "proposed",
    ...overrides,
  };
}

function rule(overrides: Partial<ActionRuleInput> = {}): ActionRuleInput {
  return { approvalMode: "required", id: "rule-1", operation: "Create task", ...overrides };
}

function event(overrides: Partial<ActivityEventInput> = {}): ActivityEventInput {
  return { id: "event-1", title: "Review North Station charge", ...overrides };
}

function disclosure(overrides: Partial<PrivacyDisclosure> = {}): PrivacyDisclosure {
  return {
    createdAt: LATER,
    disclosedFields: ["sender", "subject"],
    id: "11111111-1111-4111-8111-111111111111",
    model: "gpt-4.1-mini",
    provider: "openai",
    purpose: "semantic-clause-evaluation",
    ...overrides,
  };
}

function timeline(input: {
  disclosures?: PrivacyDisclosure[];
  events?: ActivityEventInput[];
  rules?: ActionRuleInput[];
  runs?: ActionRunInput[];
}) {
  return activityTimeline({
    disclosures: input.disclosures ?? [],
    events: input.events ?? [],
    rules: input.rules ?? [],
    runs: input.runs ?? [],
  });
}

describe("activityTimeline", () => {
  it("returns nothing when both records are empty", () => {
    expect(timeline({})).toEqual([]);
  });

  it("merges the ledger and disclosures newest first", () => {
    const entries = timeline({
      disclosures: [disclosure({ createdAt: LATER })],
      events: [event()],
      rules: [rule()],
      runs: [run({ createdAt: EARLIER })],
    });

    expect(entries.map((entry) => entry.kind)).toEqual(["disclosure", "action"]);
  });

  it("breaks ties on id so the order is total", () => {
    const entries = timeline({
      runs: [run({ createdAt: EARLIER, id: "run-b" }), run({ createdAt: EARLIER, id: "run-a" })],
      rules: [rule()],
      events: [event()],
    });

    expect(entries.map((entry) => entry.id)).toEqual(["run-a", "run-b"]);
  });

  it("sorts an unparseable timestamp last rather than throwing", () => {
    const entries = timeline({
      events: [event()],
      rules: [rule()],
      runs: [run({ createdAt: "not-a-date", id: "run-broken" }), run({ id: "run-good" })],
    });

    expect(entries.map((entry) => entry.id)).toEqual(["run-good", "run-broken"]);
  });

  it("names the event a run was about", () => {
    const [entry] = timeline({ events: [event()], rules: [rule()], runs: [run()] });

    expect(entry).toMatchObject({
      detail: "Google Tasks · Create task · Review North Station charge",
      kind: "action",
      title: "Review North Station charge",
    });
  });

  it("falls back to the operation when the event is not in hand", () => {
    const [entry] = timeline({ events: [], rules: [rule()], runs: [run()] });

    expect(entry).toMatchObject({ detail: "Google Tasks · Create task", title: "Create task" });
  });

  it("still describes a run whose rule is not in hand", () => {
    const [entry] = timeline({ events: [event()], rules: [], runs: [run()] });

    expect(entry).toMatchObject({
      detail: "Google Tasks · Action · Review North Station charge",
      kind: "action",
    });
  });

  it("drops a status this build does not understand rather than guessing", () => {
    const entries = timeline({
      events: [event()],
      rules: [rule()],
      runs: [run({ id: "run-known" }), run({ id: "run-unknown", status: "half-approved" })],
    });

    expect(entries.map((entry) => entry.id)).toEqual(["run-known"]);
  });

  it("records a decision time only once one exists", () => {
    const [pending] = timeline({ events: [event()], rules: [rule()], runs: [run()] });
    const [resolved] = timeline({
      events: [event()],
      rules: [rule()],
      runs: [run({ completedAt: LATER, status: "succeeded" })],
    });

    expect(pending).toMatchObject({ decidedAt: undefined });
    expect(resolved).toMatchObject({ decidedAt: LATER });
  });

  it("prefers the completion time over the approval time", () => {
    const [entry] = timeline({
      events: [event()],
      rules: [rule()],
      runs: [run({ approvedAt: EARLIER, completedAt: LATER, status: "succeeded" })],
    });

    expect(entry).toMatchObject({ decidedAt: LATER });
  });

  it("explains a failure by its stable code and attempt count", () => {
    const [once] = timeline({
      events: [event()],
      rules: [rule()],
      runs: [run({ attemptCount: 1, errorCode: "provider_quota", status: "failed" })],
    });
    const [repeatedly] = timeline({
      events: [event()],
      rules: [rule()],
      runs: [run({ attemptCount: 3, errorCode: null, status: "failed" })],
    });

    expect(once).toMatchObject({ problem: "Failed after 1 attempt (provider_quota)." });
    expect(repeatedly).toMatchObject({ problem: "Failed after 3 attempts." });
  });

  it("carries no problem text for a run that did not fail", () => {
    const [entry] = timeline({
      events: [event()],
      rules: [rule()],
      runs: [run({ status: "succeeded" })],
    });

    expect(entry).toMatchObject({ problem: undefined });
  });

  it("marks a pending run governed by an automatic rule", () => {
    const [entry] = timeline({
      events: [event()],
      rules: [rule({ approvalMode: "automatic" })],
      runs: [run({ status: "awaiting-approval" })],
    });

    expect(entry).toMatchObject({ statusLabel: "Awaiting your approval · automatic rule" });
  });

  it("does not add the automatic marker once a run has moved on", () => {
    const [entry] = timeline({
      events: [event()],
      rules: [rule({ approvalMode: "automatic" })],
      runs: [run({ status: "succeeded" })],
    });

    expect(entry).toMatchObject({ statusLabel: "Completed" });
  });

  it("describes a disclosure by field names, model, and provider only", () => {
    const [entry] = timeline({ disclosures: [disclosure()] });

    expect(entry).toEqual({
      fields: ["sender", "subject"],
      icon: "brain",
      id: "11111111-1111-4111-8111-111111111111",
      kind: "disclosure",
      model: "gpt-4.1-mini",
      occurredAt: LATER,
      provider: "openai",
      title: "semantic-clause-evaluation",
    });
  });
});

describe("pendingDecisionCount", () => {
  it("counts only runs still awaiting a decision", () => {
    const entries = timeline({
      events: [event()],
      rules: [rule()],
      runs: [
        run({ id: "run-1", status: "proposed" }),
        run({ id: "run-2", status: "awaiting-approval" }),
        run({ id: "run-3", status: "succeeded" }),
        run({ id: "run-4", status: "failed" }),
      ],
    });

    expect(pendingDecisionCount(entries)).toBe(2);
  });

  it("never counts a disclosure, which records something already done", () => {
    expect(pendingDecisionCount(timeline({ disclosures: [disclosure()] }))).toBe(0);
  });
});

describe("labels", () => {
  it("names every known provider and passes an unknown one through", () => {
    expect(actionProviderLabel("google-tasks")).toBe("Google Tasks");
    expect(actionProviderLabel("nextcloud-budget")).toBe("Nextcloud Budget");
    expect(actionProviderLabel("webhook")).toBe("Webhook");
    expect(actionProviderLabel("something-new")).toBe("something-new");
  });

  it("labels a completed run as completed rather than succeeded", () => {
    expect(actionStatusLabel("succeeded")).toBe("Completed");
  });

  it("treats only undecided statuses as awaiting a decision", () => {
    expect(isAwaitingDecision("proposed")).toBe(true);
    expect(isAwaitingDecision("awaiting-approval")).toBe(true);
    expect(isAwaitingDecision("approved")).toBe(false);
    expect(isAwaitingDecision("running")).toBe(false);
    expect(isAwaitingDecision("succeeded")).toBe(false);
    expect(isAwaitingDecision("failed")).toBe(false);
    expect(isAwaitingDecision("cancelled")).toBe(false);
  });

  it("keeps the read failure message free of database detail", () => {
    expect(activityErrorMessage()).toBe(
      "Relay could not load your activity. Check your connection and retry.",
    );
  });
});
