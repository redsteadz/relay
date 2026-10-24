import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SmartOverview } from "@relay/contracts";
import { AppError } from "@relay/observability";
const mock = vi.hoisted(() => ({
  claim: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  dispatch: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../src/actions", () => ({
  claimActionRunForWorkflow: mock.claim,
  completeActionRun: mock.complete,
  failActionRun: mock.fail,
}));
vi.mock("../src/providers", () => ({ dispatchProvider: mock.dispatch }));
vi.mock("../src/google-tasks-provider", () => ({ refreshGoogleTasksAccessToken: mock.refresh }));
vi.mock("../src/observability", () => ({ logPipelineError: vi.fn() }));
vi.mock("@relay/crypto", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  decryptValue: () => Promise.resolve("synthetic-refresh"),
}));
import { SmartAutomationRepository, executeSmartRun } from "../src/smart-automations";
import type { Env } from "../src/env";
const userId = "93000000-0000-4000-8000-000000000001";
const runId = "93100000-0000-4000-8000-000000000001";
const env = {
  RELAY_SMART_GOOGLE_ENABLED: "true",
  RELAY_ENVIRONMENT: "development",
  SUPABASE_URL: "http://127.0.0.1:55321",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_test_only_1234567890",
  RELAY_CREDENTIAL_KEK_KEYRING: JSON.stringify({
    activeVersion: 1,
    keys: { "1": btoa("k".repeat(32)) },
  }),
} as Env;
function fixture() {
  const rule = {
    id: runId,
    name: "Synthetic tasks",
    service: "google-tasks" as const,
    enabled: true,
    sources: ["gmail" as const],
    senders: [],
    exclusions: [],
    minimumConfidence: 0.85,
    approval: "required" as const,
    targetId: "synthetic-list",
    targetLabel: "Synthetic tasks",
    revision: 1,
  };
  const state: SmartOverview = {
    paused: false,
    rules: [rule],
    services: [
      {
        service: rule.service,
        connected: true,
        enabled: true,
        permissionRequired: false,
        targetId: rule.targetId,
        targetLabel: rule.targetLabel,
      },
    ],
    receipts: [
      {
        id: runId,
        ruleId: rule.id,
        observationId: runId,
        service: rule.service,
        title: "Synthetic request",
        targetLabel: rule.targetLabel,
        status: "approved",
        reason: "approval-required",
        createdAt: "2026-10-23T10:00:00Z",
      },
    ],
  };
  const repo = new SmartAutomationRepository(
    { ...env },
    vi.fn(() => Promise.reject(new Error("No network in execution tests"))),
  );
  vi.spyOn(repo, "read").mockResolvedValue(state);
  const db = vi.spyOn(repo, "db").mockImplementation((path) => {
    if (path === "rpc/claim_smart_outbox_v1" || path === "rpc/check_smart_dispatch_v1")
      return Promise.resolve(true);
    if (path.startsWith("connections?"))
      return Promise.resolve([
        {
          id: runId,
          scopes: ["https://www.googleapis.com/auth/tasks"],
          credential_ciphertext: "\\x" + "00".repeat(16),
          credential_nonce: "\\x" + "00".repeat(12),
          wrapped_data_key: "\\x" + "00".repeat(48),
          wrap_nonce: "\\x" + "00".repeat(12),
          key_version: 1,
        },
      ]);
    return Promise.resolve([]);
  });
  mock.claim.mockResolvedValue({
    id: runId,
    eventId: runId,
    input: { title: "Synthetic request", taskListId: "synthetic-list" },
    attemptCount: 1,
    createdAt: "2026-10-23T10:00:00Z",
  });
  return { repo, state, db };
}
describe("Smart Workflow execution (mocked ledger, credentials and provider)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.refresh.mockResolvedValue("synthetic-access");
    mock.dispatch.mockResolvedValue({ status: "delivered", providerReference: "synthetic-task" });
    mock.complete.mockResolvedValue({ status: "succeeded" });
    mock.fail.mockResolvedValue({ status: "failed" });
  });
  it("claims durable work, rechecks authorization twice, reconciles and records a receipt", async () => {
    const { repo, db } = fixture();
    await executeSmartRun(repo, userId, runId);
    expect(db.mock.calls.filter(([path]) => path === "rpc/check_smart_dispatch_v1")).toHaveLength(
      2,
    );
    expect(mock.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ id: runId, provider: "google-tasks", operation: "create-task" }),
      expect.objectContaining({ accessToken: "synthetic-access", attempt: 2 }),
    );
    expect(mock.complete).toHaveBeenCalledOnce();
    expect(db).toHaveBeenCalledWith(
      expect.stringContaining(`user_id=eq.${userId}&action_run_id=eq.${runId}`),
      "DELETE",
    );
  });
  it("does not claim or dispatch paused work", async () => {
    const { repo, state, db } = fixture();
    state.paused = true;
    await executeSmartRun(repo, userId, runId);
    expect(db).not.toHaveBeenCalled();
    expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it("does not execute a disabled or disconnected integration", async () => {
    const { repo, state } = fixture();
    state.services[0]!.connected = false;
    await executeSmartRun(repo, userId, runId);
    expect(mock.claim).not.toHaveBeenCalled();
  });
  it("refuses execution when another worker owns the lease", async () => {
    const { repo, db } = fixture();
    db.mockResolvedValueOnce(false);
    await executeSmartRun(repo, userId, runId);
    expect(mock.dispatch).not.toHaveBeenCalled();
  });
  it("records an ambiguous provider outcome without authorizing a blind retry", async () => {
    const { repo, db } = fixture();
    mock.dispatch.mockRejectedValue(new Error("Lost provider reply"));
    await executeSmartRun(repo, userId, runId);
    expect(db).toHaveBeenCalledWith(
      expect.stringContaining("smart_action_outbox?"),
      "PATCH",
      expect.objectContaining({ outcome_unknown: true, lease_until: null }),
    );
    expect(mock.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: "outcome-unknown", retryable: false }),
      expect.anything(),
    );
    expect(mock.complete).not.toHaveBeenCalled();
  });
  it("backs off a known rate limit", async () => {
    const { repo } = fixture();
    mock.dispatch.mockRejectedValue(
      new AppError("Synthetic throttle", {
        code: "RATE_LIMIT",
        category: "rate-limit",
        statusCode: 429,
        cause: new Error("Synthetic"),
      }),
    );
    await expect(executeSmartRun(repo, userId, runId)).rejects.toMatchObject({
      code: "SMART_RETRY_DEFERRED",
    });
    expect(mock.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ retryable: true }),
      expect.anything(),
    );
  });
  it("marks a rejected permission for reconnect and stops automatic retry", async () => {
    const { repo, db } = fixture();
    mock.dispatch.mockRejectedValue(
      new AppError("Synthetic permission failure", {
        code: "PERMISSION",
        category: "forbidden",
        statusCode: 403,
        cause: new Error("Synthetic"),
      }),
    );
    await executeSmartRun(repo, userId, runId);
    expect(db).toHaveBeenCalledWith(expect.stringContaining("smart_google_services?"), "PATCH", {
      permission_required: true,
    });
    expect(mock.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: "permission-required", retryable: false }),
      expect.anything(),
    );
  });
});
