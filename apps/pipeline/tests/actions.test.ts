import { describe, expect, it, vi } from "vitest";

import { relayActionRunId } from "@relay/domain";

import { ActionLedgerError, claimActionRunForWorkflow, proposeActionRun } from "../src/actions";
import type { PersistenceConfiguration } from "../src/configuration";

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const actionRuleId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";
const eventId = "06f96f7d-3e1a-4a66-b98e-58be9766b96e";

const configuration: PersistenceConfiguration = {
  environment: "development",
  keyring: { activeVersion: 1, keys: {} },
  supabase: {
    url: "https://supabase.example.test",
    serviceRoleKey: "sb_secret_synthetic_backend_key_12345",
  },
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function storedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: await relayActionRunId(actionRuleId, eventId),
    user_id: userId,
    action_rule_id: actionRuleId,
    event_id: eventId,
    provider: "google-tasks",
    status: "awaiting-approval",
    approval_mode: "required",
    input: { title: "Synthetic task" },
    attempt_count: 0,
    provider_reference: null,
    workflow_instance_id: null,
    approved_at: null,
    completed_at: null,
    created_at: "2026-08-30T12:00:00.000Z",
    ...overrides,
  };
}

function jsonBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe("proposeActionRun", () => {
  it("sends only identity and input, never a provider or approval mode", async () => {
    const row = await storedRun();
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json(row)));

    const run = await proposeActionRun(
      configuration,
      { userId, actionRuleId, eventId, input: { title: "Synthetic task" } },
      fetcher,
    );

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://supabase.example.test/rest/v1/rpc/propose_action_run_v1");
    const body = jsonBody(init);
    expect(Object.keys(body).sort()).toEqual([
      "p_action_rule_id",
      "p_event_id",
      "p_input",
      "p_user_id",
    ]);
    // The wire shape has no room to ask for a provider, a status, or automatic approval.
    expect(JSON.stringify(body)).not.toContain("approval");
    expect(JSON.stringify(body)).not.toContain("provider");
    expect(run.provider).toBe("google-tasks");
    expect(run.approvalMode).toBe("required");
  });

  it("returns the deterministic identity the database derived", async () => {
    const row = await storedRun();
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json(row)));
    const run = await proposeActionRun(
      configuration,
      { userId, actionRuleId, eventId, input: {} },
      fetcher,
    );
    expect(run.id).toBe(await relayActionRunId(actionRuleId, eventId));
  });

  it.each([
    ["provider", { provider: "webhook" }],
    ["endpoint", { endpoint: "https://attacker.example.test" }],
    ["credential", { credential: "sk_live_example" }],
    ["operation", { operation: "transfer" }],
    ["a nested provider", { payload: { nested: [{ provider: "webhook" }] } }],
  ])("refuses input carrying %s before contacting the database", async (_name, input) => {
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json({})));
    await expect(
      proposeActionRun(configuration, { userId, actionRuleId, eventId, input }, fetcher),
    ).rejects.toMatchObject({ reason: "action_ledger_rejected" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps an unavailable or disabled rule to one reason", async () => {
    const fetcher = vi.fn<Fetcher>(() =>
      Promise.resolve(Response.json({ code: "P0002", message: "unavailable" }, { status: 400 })),
    );
    await expect(
      proposeActionRun(configuration, { userId, actionRuleId, eventId, input: {} }, fetcher),
    ).rejects.toMatchObject({ reason: "action_rule_unavailable" });
  });

  it("rejects a response whose run contradicts its own status", async () => {
    // Approved-at set while still awaiting a decision is exactly what the database check forbids;
    // the contract refuses to hand such a row onward even if one appeared.
    const row = await storedRun({ approved_at: "2026-08-30T12:05:00.000Z" });
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json(row)));
    await expect(
      proposeActionRun(configuration, { userId, actionRuleId, eventId, input: {} }, fetcher),
    ).rejects.toMatchObject({ reason: "action_ledger_response_invalid" });
  });

  it("rejects a response naming a provider the contract does not know", async () => {
    const row = await storedRun({ provider: "attacker-service" });
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json(row)));
    await expect(
      proposeActionRun(configuration, { userId, actionRuleId, eventId, input: {} }, fetcher),
    ).rejects.toMatchObject({ reason: "action_ledger_response_invalid" });
  });

  it("reports the ledger unavailable when persistence is not configured", async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json({})));
    await expect(
      proposeActionRun(
        { environment: "development", keyring: { activeVersion: 1, keys: {} } },
        { userId, actionRuleId, eventId, input: {} },
        fetcher,
      ),
    ).rejects.toMatchObject({ reason: "action_ledger_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports the ledger unavailable when the request cannot be sent", async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.reject(new Error("offline")));
    await expect(
      proposeActionRun(configuration, { userId, actionRuleId, eventId, input: {} }, fetcher),
    ).rejects.toMatchObject({ reason: "action_ledger_unavailable" });
  });
});

describe("claimActionRunForWorkflow", () => {
  it("claims an approved run for one workflow instance", async () => {
    const actionRunId = await relayActionRunId(actionRuleId, eventId);
    const row = await storedRun({
      status: "running",
      approved_at: "2026-08-30T12:05:00.000Z",
      workflow_instance_id: "workflow-a",
      attempt_count: 1,
    });
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json(row)));

    const run = await claimActionRunForWorkflow(
      configuration,
      { userId, actionRunId, workflowInstanceId: "workflow-a" },
      fetcher,
    );

    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://supabase.example.test/rest/v1/rpc/claim_action_run_for_workflow_v1");
    expect(jsonBody(init)).toEqual({
      p_user_id: userId,
      p_action_run_id: actionRunId,
      p_workflow_instance_id: "workflow-a",
    });
    expect(run.status).toBe("running");
    expect(run.attemptCount).toBe(1);
  });

  it("maps a run already claimed by another workflow to a conflict", async () => {
    const actionRunId = await relayActionRunId(actionRuleId, eventId);
    const fetcher = vi.fn<Fetcher>(() =>
      Promise.resolve(Response.json({ code: "55006" }, { status: 400 })),
    );
    await expect(
      claimActionRunForWorkflow(
        configuration,
        { userId, actionRunId, workflowInstanceId: "workflow-b" },
        fetcher,
      ),
    ).rejects.toMatchObject({ reason: "action_ledger_conflict" });
  });

  it("maps an ineligible run to the unavailable reason", async () => {
    const actionRunId = await relayActionRunId(actionRuleId, eventId);
    const fetcher = vi.fn<Fetcher>(() =>
      Promise.resolve(Response.json({ code: "P0002" }, { status: 400 })),
    );
    await expect(
      claimActionRunForWorkflow(
        configuration,
        { userId, actionRunId, workflowInstanceId: "workflow-a" },
        fetcher,
      ),
    ).rejects.toMatchObject({ reason: "action_rule_unavailable" });
  });

  it.each([
    ["", "blank"],
    ["  ", "whitespace"],
    [" workflow-a", "padded"],
  ])(
    "refuses a %j workflow instance (%s) before contacting the database",
    async (workflowInstanceId) => {
      const actionRunId = await relayActionRunId(actionRuleId, eventId);
      const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json({})));
      await expect(
        claimActionRunForWorkflow(
          configuration,
          { userId, actionRunId, workflowInstanceId },
          fetcher,
        ),
      ).rejects.toBeInstanceOf(ActionLedgerError);
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});
