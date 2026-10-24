import {
  smartCommandSchema,
  smartOverviewSchema,
  type SmartObservation,
  type SmartOverview,
  type SmartReceipt,
} from "@relay/contracts";
import {
  evaluateSmartRule,
  smartEffectKey,
  renderSmartInput,
  smartActionPreview,
} from "@relay/domain";
import { DEMO_USER_ID } from "./account";
import { demoUuid, demoRandomUuid } from "./ids";
import { demoDatabase } from "./store";
import { applyCapture } from "./ingest";

export function initialSmartDemo(): SmartOverview {
  const services = (["gmail", "google-sheets", "google-calendar", "google-tasks"] as const).map(
    (service) => ({
      service,
      connected: true,
      enabled: true,
      permissionRequired: false,
      targetId: `demo-${service}`,
      targetLabel:
        service === "google-sheets"
          ? "Personal expenses · Relay Expenses"
          : service === "google-calendar"
            ? "Personal calendar"
            : service === "google-tasks"
              ? "My tasks"
              : "Approved Gmail account",
    }),
  );
  return {
    paused: false,
    services,
    receipts: [],
    rules: (["google-sheets", "google-calendar", "google-tasks"] as const).map((service) => ({
      id: demoUuid(`smart-rule:${service}`),
      name:
        service === "google-sheets"
          ? "Record verified transactions"
          : service === "google-calendar"
            ? "Propose meetings"
            : "Capture actionable requests",
      service,
      enabled: true,
      sources: ["gmail", "sms", "notification"],
      senders: [],
      exclusions: [],
      minimumConfidence: 0.95,
      approval: service === "google-sheets" ? "automatic" : "required",
      targetId: `demo-${service}`,
      targetLabel: services.find((item) => item.service === service)?.targetLabel ?? "",
      revision: 1,
    })),
  };
}

export async function smartDemoOverview(): Promise<SmartOverview> {
  await demoDatabase.ready();
  const rows = demoDatabase.rows("smart_automations");
  if (rows.length === 0) rows.push({ state: initialSmartDemo(), keys: [] });
  return smartOverviewSchema.parse(rows[0]?.state);
}

function save(state: SmartOverview): void {
  for (const receipt of state.receipts) {
    if (receipt.status === "blocked" || receipt.status === "duplicate") continue;
    const runs = demoDatabase.rows("action_runs");
    let run = runs.find((item) => item.id === receipt.id);
    const rule = state.rules.find((item) => item.id === receipt.ruleId);
    if (rule === undefined) continue;
    if (run === undefined) {
      const capture = applyCapture(demoDatabase.document(), {
        sourceKind: receipt.service === "google-sheets" ? "sms" : "gmail",
        sender: "synthetic@relay.invalid",
        subject: receipt.title,
        body: "Synthetic Smart Automations preview. No external action occurs.",
      });
      const eventId = capture.eventIds[0];
      if (eventId !== undefined) receipt.observationId = eventId;
      if (!demoDatabase.rows("action_rules").some((item) => item.id === rule.id))
        demoDatabase.rows("action_rules").push({
          id: rule.id,
          user_id: DEMO_USER_ID,
          provider: rule.service,
          operation:
            rule.service === "google-tasks"
              ? "create-task"
              : rule.service === "google-calendar"
                ? "create-event"
                : "record-transaction",
          approval_mode: rule.approval,
          enabled: rule.enabled,
        });
      run = {
        id: receipt.id,
        user_id: DEMO_USER_ID,
        action_rule_id: rule.id,
        event_id: receipt.observationId,
        provider: receipt.service,
        input: { title: receipt.title },
        created_at: receipt.createdAt,
      };
      runs.unshift(run);
    }
    run.status = receipt.status;
    run.approval_mode = rule.approval;
    run.attempt_count = receipt.status === "succeeded" ? 1 : 0;
    run.approved_at = receipt.status === "succeeded" ? receipt.createdAt : null;
    run.completed_at = ["succeeded", "failed", "cancelled"].includes(receipt.status)
      ? new Date().toISOString()
      : null;
    run.error_code = receipt.status === "failed" ? receipt.reason : null;
  }
  const row = demoDatabase.rows("smart_automations")[0];
  if (row !== undefined) row.state = state;
  demoDatabase.touch();
}

/** Outcomes are synthetic. The shared authorization/deduplication functions are the real ones. */
export async function runSmartDemoScenario(scenario: string): Promise<SmartOverview> {
  if (scenario === "duplicate") {
    await runSmartDemoScenario("transaction");
    scenario = "duplicate-of-transaction";
  }
  const state = await smartDemoOverview();
  const serviceId =
    scenario === "meeting"
      ? "google-calendar"
      : scenario === "task" || scenario === "approval"
        ? "google-tasks"
        : "google-sheets";
  const service = state.services.find((item) => item.service === serviceId);
  if (service !== undefined && scenario === "permission") service.permissionRequired = true;
  if (service !== undefined && scenario === "disconnected") service.connected = false;
  const rule = state.rules.find((item) => item.service === serviceId);
  if (rule === undefined) throw new Error("Synthetic rule missing");
  const observation: SmartObservation = {
    id: demoRandomUuid(),
    source: scenario === "transaction" || scenario === "duplicate" ? "sms" : "gmail",
    sender: "synthetic@bank.invalid",
    kind:
      serviceId === "google-sheets"
        ? "transaction"
        : serviceId === "google-calendar"
          ? "meeting"
          : "task",
    title:
      serviceId === "google-sheets"
        ? "North Station · 42.50 USD"
        : serviceId === "google-calendar"
          ? "Project review · Friday 14:00 UTC"
          : "Review the assignment before Friday",
    confidence: 0.99,
    requiresReview: false,
    occurredAt: "2026-10-23T10:00:00.000Z",
    ...(serviceId === "google-sheets"
      ? {
          amount: "42.50",
          currency: "USD",
          reference: "SYNTHETIC-TXN-1042",
          merchant: "North Station",
        }
      : {}),
    ...(serviceId === "google-calendar"
      ? { startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T14:30:00.000Z" }
      : {}),
  };
  const key = await smartEffectKey(DEMO_USER_ID, rule, observation);
  const row = demoDatabase.rows("smart_automations")[0];
  const keys = Array.isArray(row?.keys) ? (row.keys as string[]) : [];
  const decision = evaluateSmartRule(rule, observation, state);
  const duplicate = keys.includes(key);
  const status = !decision.eligible
    ? "blocked"
    : duplicate
      ? "duplicate"
      : decision.approval === "required"
        ? "awaiting-approval"
        : "succeeded";
  const receipt: SmartReceipt = {
    preview: smartActionPreview(
      rule.service,
      renderSmartInput(rule, observation, "synthetic-preview"),
    ),
    id: demoRandomUuid(),
    observationId: observation.id,
    ruleId: rule.id,
    service: rule.service,
    title: observation.title,
    targetLabel: rule.targetLabel,
    status,
    reason: !decision.eligible
      ? decision.reason === "unmatched"
        ? "needs-review"
        : decision.reason
      : duplicate
        ? "duplicate"
        : status === "awaiting-approval"
          ? "approval-required"
          : "completed",
    createdAt: new Date().toISOString(),
  };
  if (decision.eligible && !duplicate) {
    keys.push(key);
    if (row !== undefined) row.keys = keys;
  }
  state.receipts.unshift(receipt);
  state.receipts = state.receipts.slice(0, 200);
  save(state);
  return state;
}

export async function commandSmartDemo(value: unknown): Promise<SmartOverview> {
  const command = smartCommandSchema.parse(value);
  const state = await smartDemoOverview();
  if (command.type === "pause") state.paused = command.paused;
  if (command.type === "destination") {
    const service = state.services.find((item) => item.service === command.service);
    if (service !== undefined) {
      service.targetId = command.targetId;
      service.targetLabel = "Synthetic destination";
      service.enabled = true;
    }
  }
  if (command.type === "create-sheet") {
    const service = state.services.find((item) => item.service === "google-sheets");
    if (service !== undefined) {
      service.targetId = "demo-google-sheets";
      service.targetLabel = "Personal expenses · Relay Expenses";
      service.enabled = true;
    }
  }
  if (command.type === "service" || command.type === "disconnect") {
    const service = state.services.find((item) => item.service === command.service);
    if (service !== undefined) {
      service.enabled = command.type === "service" && command.enabled;
      if (command.type === "disconnect") service.connected = false;
    }
  }
  if (command.type === "save-rule") {
    const index = state.rules.findIndex((item) => item.id === command.rule.id);
    if (index < 0) {
      state.rules.push(command.rule);
      save(state);
      return state;
    }
    const current = state.rules[index];
    if (current?.revision !== command.rule.revision) throw new Error("Rule changed");
    state.rules[index] = { ...command.rule, revision: command.rule.revision + 1 };
    for (const receipt of state.receipts) {
      if (receipt.ruleId === command.rule.id && receipt.status === "awaiting-approval") {
        receipt.status = "cancelled";
        receipt.reason = "cancelled";
      }
    }
  }
  if (command.type === "approve" || command.type === "cancel" || command.type === "retry") {
    const receipt = state.receipts.find((item) => item.id === command.receiptId);
    if (receipt === undefined) throw new Error("Receipt missing");
    if (command.type === "cancel" && receipt.status === "awaiting-approval") {
      receipt.status = "cancelled";
      receipt.reason = "cancelled";
    } else if (command.type === "approve" && receipt.status === "awaiting-approval") {
      const service = state.services.find((item) => item.service === receipt.service);
      const rule = state.rules.find((item) => item.id === receipt.ruleId);
      if (
        state.paused ||
        service?.connected !== true ||
        !service.enabled ||
        service.permissionRequired ||
        rule?.enabled !== true
      )
        throw new Error("Execution blocked");
      receipt.status = "succeeded";
      receipt.reason = "completed";
    } else throw new Error("Transition refused");
  }
  save(state);
  return state;
}

export async function connectSmartDemo(serviceId: string): Promise<SmartOverview> {
  const state = await smartDemoOverview();
  const service = state.services.find((item) => item.service === serviceId);
  if (service === undefined) throw new Error("Service missing");
  service.connected = true;
  service.enabled = true;
  service.permissionRequired = false;
  save(state);
  return state;
}
