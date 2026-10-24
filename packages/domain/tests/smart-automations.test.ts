import { describe, expect, it } from "vitest";
import {
  smartObservationSchema,
  smartRuleSchema,
  type SmartObservation,
  type SmartRule,
} from "@relay/contracts";
import {
  evaluateSmartRule,
  renderSmartInput,
  smartEffectKey,
  GOOGLE_SERVICE_SCOPES,
} from "../src/smart-automations";

const rule: SmartRule = {
  id: "e715ab3c-fecf-45de-a665-8f527bacb898",
  name: "Expenses",
  service: "google-sheets",
  enabled: true,
  sources: ["gmail", "sms"],
  senders: [],
  exclusions: [],
  minimumConfidence: 0.95,
  approval: "required",
  targetId: "synthetic-sheet",
  targetLabel: "Expenses",
  revision: 1,
};
const observation: SmartObservation = {
  id: "6e30be71-27c7-4651-8ca3-00135ec5dada",
  source: "gmail",
  sender: "synthetic@bank.invalid",
  kind: "transaction",
  title: "Expense",
  confidence: 0.99,
  requiresReview: false,
  occurredAt: "2026-10-23T10:00:00Z",
  amount: "9007199254740993.01",
  currency: "USD",
  reference: "SYNTHETIC-1042",
};
const state = {
  paused: false,
  services: [
    {
      service: rule.service,
      enabled: true,
      connected: true,
      permissionRequired: false,
      targetId: rule.targetId,
      targetLabel: "Expenses",
    },
  ],
};
describe("smart automation authorization", () => {
  it("requires explicit approval by default", () => {
    expect(evaluateSmartRule(rule, observation, state)).toEqual({
      eligible: true,
      approval: "required",
    });
  });
  it.each(["paused", "disconnected", "permission-required", "needs-review"] as const)(
    "enforces %s independently of confidence",
    (reason) => {
      const current = structuredClone(state);
      const input = structuredClone(observation);
      if (reason === "paused") current.paused = true;
      if (reason === "disconnected") current.services[0]!.connected = false;
      if (reason === "permission-required") current.services[0]!.permissionRequired = true;
      if (reason === "needs-review") input.requiresReview = true;
      expect(evaluateSmartRule({ ...rule, approval: "automatic" }, input, current)).toEqual({
        eligible: false,
        reason,
      });
    },
  );
  it("exclusions win over sender allowlists and normalize case", () => {
    expect(
      evaluateSmartRule(
        { ...rule, senders: [observation.sender], exclusions: [observation.sender.toUpperCase()] },
        observation,
        state,
      ),
    ).toEqual({ eligible: false, reason: "unmatched" });
  });
  it("does not treat high confidence as a substitute for transaction evidence", () => {
    const withoutReference = { ...observation };
    delete withoutReference.reference;
    expect(evaluateSmartRule(rule, withoutReference, state)).toEqual({
      eligible: false,
      reason: "needs-review",
    });
  });
  it("rejects an unapproved destination", () => {
    expect(
      evaluateSmartRule({ ...rule, targetId: "other-sheet" }, observation, state).eligible,
    ).toBe(false);
  });
  it("preserves exact money and treats formula-like data as values", () => {
    const result = renderSmartInput(
      rule,
      { ...observation, merchant: "=IMPORTXML(unsafe)" },
      "synthetic-action",
    );
    expect(result.values).toEqual([
      "synthetic-action",
      observation.occurredAt,
      "=IMPORTXML(unsafe)",
      observation.amount,
      "USD",
      observation.reference,
      "gmail",
    ]);
  });
  it("deduplicates the same transaction across Gmail and SMS without crossing tenant/target boundaries", async () => {
    const first = await smartEffectKey("tenant-a", rule, observation);
    expect(
      await smartEffectKey("tenant-a", rule, {
        ...observation,
        id: crypto.randomUUID(),
        source: "sms",
        sender: "BANK",
      }),
    ).toBe(first);
    expect(await smartEffectKey("tenant-b", rule, observation)).not.toBe(first);
    expect(await smartEffectKey("tenant-a", { ...rule, targetId: "other" }, observation)).not.toBe(
      first,
    );
    expect(
      await smartEffectKey("tenant-a", rule, { ...observation, reference: "different" }),
    ).not.toBe(first);
  });
  it("rejects injected authority, unexpected fields, invalid thresholds, and empty sources", () => {
    expect(
      smartObservationSchema.safeParse({ ...observation, operation: "send-email" }).success,
    ).toBe(false);
    expect(smartRuleSchema.safeParse({ ...rule, minimumConfidence: 0.1 }).success).toBe(false);
    expect(smartRuleSchema.safeParse({ ...rule, sources: [] }).success).toBe(false);
  });
  it("does not request sending, deleting, or full Drive permissions", () => {
    expect(Object.values(GOOGLE_SERVICE_SCOPES).flat()).not.toContain("https://mail.google.com/");
    expect(GOOGLE_SERVICE_SCOPES["google-sheets"]).toEqual([
      "https://www.googleapis.com/auth/drive.file",
    ]);
  });
});
