import { describe, expect, it } from "vitest";

import {
  actionDecisionErrorMessage,
  actionDecisionMessage,
  actionOperationLabel,
  proposalsByEvent,
  proposedAction,
  type ActionRuleInput,
  type ActionRunInput,
} from "./actionPresentation";

const rules = new Map<string, ActionRuleInput>([
  ["rule-1", { id: "rule-1", operation: "create-task" }],
]);

function run(overrides: Partial<ActionRunInput> = {}): ActionRunInput {
  return {
    actionRuleId: "rule-1",
    createdAt: "2026-09-04T12:41:00.000Z",
    due: "2026-09-04T18:00:00.000Z",
    eventId: "event-1",
    id: "run-1",
    provider: "google-tasks",
    status: "awaiting-approval",
    title: "Review North Station charge",
    ...overrides,
  };
}

describe("proposed actions", () => {
  it("names the provider and the rendered action", () => {
    const proposal = proposedAction(run(), rules);
    expect(proposal?.provider).toBe("Google Tasks");
    expect(proposal?.title).toBe("Review North Station charge");
    expect(proposal?.due).toBe("2026-09-04T18:00:00.000Z");
  });

  it("falls back to the rule's operation when the provider rendered no title", () => {
    expect(proposedAction(run({ title: null }), rules)?.title).toBe("Create task");
    expect(proposedAction(run({ title: "" }), rules)?.title).toBe("Create task");
  });

  it("names the proposal even when its rule cannot be read", () => {
    expect(proposedAction(run({ title: null }), new Map())?.title).toBe("Proposed action");
  });

  it("treats a missing due date as absent rather than empty", () => {
    expect(proposedAction(run({ due: null }), rules)?.due).toBeUndefined();
    expect(proposedAction(run({ due: "" }), rules)?.due).toBeUndefined();
  });

  it("names an unrecognized provider as-is rather than hiding the proposal", () => {
    expect(proposedAction(run({ provider: "future-provider" }), rules)?.provider).toBe(
      "future-provider",
    );
  });

  // A control offered for a decision the database would refuse is the one failure mode an approval
  // surface cannot have, so availability mirrors `decide_action_run`'s transition table exactly.
  it("offers approval only while the run is awaiting one", () => {
    expect(proposedAction(run({ status: "awaiting-approval" }), rules)?.canApprove).toBe(true);
    expect(proposedAction(run({ status: "proposed" }), rules)?.canApprove).toBe(false);
    expect(proposedAction(run({ status: "approved" }), rules)?.canApprove).toBe(false);
    expect(proposedAction(run({ status: "running" }), rules)?.canApprove).toBe(false);
  });

  it("keeps cancellation available until the action starts", () => {
    expect(proposedAction(run({ status: "proposed" }), rules)?.canSkip).toBe(true);
    expect(proposedAction(run({ status: "awaiting-approval" }), rules)?.canSkip).toBe(true);
    expect(proposedAction(run({ status: "approved" }), rules)?.canSkip).toBe(true);
    expect(proposedAction(run({ status: "running" }), rules)?.canSkip).toBe(false);
    expect(proposedAction(run({ status: "succeeded" }), rules)?.canSkip).toBe(false);
  });

  it("drops a status this build cannot classify rather than guessing at it", () => {
    expect(proposedAction(run({ status: "quantum-superposition" }), rules)).toBeUndefined();
  });

  it("orders two proposals for one event newest first", () => {
    const older = proposedAction(
      run({ createdAt: "2026-09-04T08:00:00.000Z", id: "run-2" }),
      rules,
    );
    const newer = proposedAction(run(), rules);
    expect(older).toBeDefined();
    expect(newer).toBeDefined();
    const grouped = proposalsByEvent([older!, newer!]);
    expect(grouped.get("event-1")?.map((entry) => entry.id)).toEqual(["run-1", "run-2"]);
  });

  it("keeps proposals for different events apart", () => {
    const first = proposedAction(run(), rules);
    const second = proposedAction(run({ eventId: "event-2", id: "run-3" }), rules);
    const grouped = proposalsByEvent([first!, second!]);
    expect(grouped.get("event-1")).toHaveLength(1);
    expect(grouped.get("event-2")).toHaveLength(1);
  });
});

describe("operation labels", () => {
  it("reshapes a slug without inventing words", () => {
    expect(actionOperationLabel("create-task")).toBe("Create task");
    expect(actionOperationLabel("record_transaction")).toBe("Record transaction");
  });

  it("returns an empty operation unchanged rather than as a stray capital", () => {
    expect(actionOperationLabel("")).toBe("");
  });
});

describe("decision messages", () => {
  // Approving records a decision; a Workflow dispatches afterwards. The message must not claim the
  // provider already has it.
  it("confirms the decision without claiming delivery", () => {
    expect(actionDecisionMessage("approve", "Google Tasks")).toBe("Sent to Google Tasks");
    expect(actionDecisionMessage("cancel", "Google Tasks")).toBe("Skipped · nothing sent");
  });

  it("says a failed approval sent nothing and is still waiting", () => {
    expect(actionDecisionErrorMessage("approve")).toContain("Nothing was sent");
    expect(actionDecisionErrorMessage("approve")).toContain("still waiting");
    expect(actionDecisionErrorMessage("cancel")).toContain("still waiting");
  });
});
