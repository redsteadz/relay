import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeSourceFacts, extractSourceEvents } from "@relay/domain";
import type { IngressEnvelope, SmartRule } from "@relay/contracts";
import type { Env } from "../src/env";
import { planSmartSource } from "../src/smart-automations";

const userId = "93000000-0000-4000-8000-000000000001";
const sourceId = "93100000-0000-4000-8000-000000000001";
const eventId = "93200000-0000-4000-8000-000000000001";
const filterId = "93300000-0000-4000-8000-000000000001";
const rule: SmartRule = {
  id: "93400000-0000-4000-8000-000000000001",
  filterRuleId: filterId,
  name: "Synthetic bank transactions",
  service: "google-sheets",
  enabled: true,
  sources: ["gmail", "sms"],
  senders: [],
  exclusions: [],
  minimumConfidence: 0.95,
  approval: "required",
  targetId: "synthetic-sheet",
  targetLabel: "Synthetic expenses",
  revision: 1,
};
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

describe("canonical capture to Smart Automation proposal (mocked database)", () => {
  afterEach(() => vi.unstubAllGlobals());
  function fixture(source: "gmail" | "sms", paused = false, classified = true) {
    const envelope: IngressEnvelope = {
      schemaVersion: 1,
      id: sourceId,
      source: { kind: source, externalId: "synthetic-1042" },
      sender: "synthetic@bank.invalid",
      occurredAt: "2026-10-23T10:00:00Z",
      capturedAt: "2026-10-23T10:00:01Z",
      body: "Untrusted source text must not enter the action payload.",
      attributes: {
        amount: "42.50",
        currency: "USD",
        merchant: "North Station",
        reference: { kind: "transaction", value: "SYNTHETIC-1042" },
      },
    };
    const facts = normalizeSourceFacts(envelope);
    const events = extractSourceEvents(facts);
    const event = events.events[0]!;
    const proposals: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input);
        expect(url.hostname).toBe("127.0.0.1");
        if (
          !url.pathname.includes("/rpc/") &&
          !url.pathname.endsWith("smart_action_outbox") &&
          !url.pathname.endsWith("smart_google_oauth_sessions")
        )
          expect(url.searchParams.get("user_id")).toMatch(/93000000/u);
        const table = url.pathname.split("/").pop();
        if (table === "propose_smart_action_v1") {
          const body = JSON.parse(init?.body as string) as Record<string, unknown>;
          proposals.push(body);
          return Promise.resolve(Response.json(eventId));
        }
        const data: Record<string, unknown> = {
          smart_automation_settings: [{ paused }],
          smart_google_services: [
            {
              service: rule.service,
              connection_id: filterId,
              enabled: true,
              permission_required: false,
              target_id: rule.targetId,
              target_label: rule.targetLabel,
            },
          ],
          smart_automation_rules: [{ configuration: rule }],
          smart_action_effects: [],
          smart_action_outbox: [],
          smart_google_oauth_sessions: [],
          source_items: [{ source, sender: envelope.sender, occurred_at: envelope.occurredAt }],
          relay_events: [
            {
              id: eventId,
              kind: event.kind,
              title: event.title,
              confidence: event.confidence,
              requires_review: event.requiresReview,
              starts_at: event.startsAt ?? null,
              ends_at: event.endsAt ?? null,
              due_at: event.dueAt ?? null,
            },
          ],
          source_facts: facts.facts
            .filter((fact) => fact.certainty === "certain")
            .map((fact) => ({ kind: fact.kind, value: "value" in fact ? fact.value : null })),
          classifications: classified ? [{ id: filterId }] : [],
        };
        if (table === undefined || !(table in data))
          throw new Error("Unexpected test database operation");
        return Promise.resolve(Response.json(data[table]));
      }),
    );
    return proposals;
  }
  it("normalizes and proposes the same financial effect for Gmail and SMS without forwarding raw text", async () => {
    const gmail = fixture("gmail");
    await planSmartSource(env, userId, sourceId);
    expect(gmail).toHaveLength(1);
    const sms = fixture("sms");
    await planSmartSource(env, userId, sourceId);
    expect(sms).toHaveLength(1);
    expect(sms[0]?.p_effect_key).toBe(gmail[0]?.p_effect_key);
    expect(JSON.stringify(sms)).not.toContain("Untrusted source text");
    expect(sms[0]?.p_rule_id).toBe(rule.id);
  });
  it("does not propose when globally paused", async () => {
    const proposals = fixture("gmail", true);
    await planSmartSource(env, userId, sourceId);
    expect(proposals).toHaveLength(0);
  });
  it("requires the exact server classification before a provider proposal", async () => {
    const proposals = fixture("sms", false, false);
    await planSmartSource(env, userId, sourceId);
    expect(proposals).toHaveLength(0);
  });
});
