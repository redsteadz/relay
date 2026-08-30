import { describe, expect, it, vi } from "vitest";

import { encryptValue, generateKek, type KekKeyring } from "@relay/crypto";
import { filterPlanSchema, type FilterPlan } from "@relay/contracts";

import type { PersistenceConfiguration } from "../src/configuration";
import { base64ToPostgresBytea, connectionCredentialEncryptionContext } from "../src/encryption";
import {
  evaluateFilterWithSemantics,
  evaluateSemanticClause,
  recordSemanticDisclosure,
  SEMANTIC_RESPONSE_JSON_SCHEMA,
  SEMANTIC_SYSTEM_INSTRUCTIONS,
  semanticEvaluationRequestBody,
} from "../src/semantic";
import injectionFixture from "../../../packages/domain/tests/fixtures/semantic-injection.json" with { type: "json" };

const userId = "638ce145-a77d-4c32-b798-cb398e881fc9";
const connectionId = "5e106d7a-85aa-4a08-9a1f-cb13b42df1f8";
const sourceItemId = "06f96f7d-3e1a-4a66-b98e-58be9766b96e";
const disclosureId = "9a4f0d21-3f4c-4c2e-8f7a-1d0b6c9e5a33";
const apiKey = "sk-synthetic-openai-key-000000000000";

const keyring: KekKeyring = { activeVersion: 1, keys: { 1: generateKek() } };
const configuration: PersistenceConfiguration = {
  environment: "development",
  keyring,
  supabase: {
    url: "https://supabase.example.test",
    serviceRoleKey: "sb_secret_synthetic_backend_key_12345",
  },
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const item = {
  attributes: { amount: "10.50", currency: "USD", merchant: "Synthetic Store" },
  sender: "billing@example.test",
  source: { applicationId: "com.example.app", kind: "email" },
  subject: "Your invoice is ready",
  body: "The quarterly invoice is attached and due next week.",
};

function plan(overrides: Record<string, unknown> = {}): FilterPlan {
  return filterPlanSchema.parse({
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "synthetic intent",
    deterministic: { field: "source.kind", operator: "equals", value: "email" },
    semantic: {
      question: "Is this message time sensitive?",
      minimumConfidence: 0.8,
      allowedFields: ["subject", "body"],
    },
    ...overrides,
  });
}

function clauseOf(value: FilterPlan) {
  if (value.semantic === undefined) throw new Error("fixture plan lost its semantic clause");
  return value.semantic;
}

async function connectionRow() {
  const encrypted = await encryptValue(
    apiKey,
    keyring,
    connectionCredentialEncryptionContext(userId, connectionId),
  );
  return {
    id: connectionId,
    credential_ciphertext: base64ToPostgresBytea(encrypted.ciphertext),
    credential_nonce: base64ToPostgresBytea(encrypted.nonce),
    wrapped_data_key: base64ToPostgresBytea(encrypted.wrappedKey),
    wrap_nonce: base64ToPostgresBytea(encrypted.wrapNonce),
    key_version: encrypted.keyVersion,
    encryption_environment: "development",
  };
}

function completion(payload: Record<string, unknown>): Response {
  return Response.json({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(payload) } }],
  });
}

/** Serves the credential lookup, then hands every OpenAI call to `onProviderCall`. */
async function stubFetcher(
  onProviderCall: (init: RequestInit | undefined) => Promise<Response> | Response,
  rows?: unknown[],
): Promise<{ calls: string[]; fetcher: ReturnType<typeof vi.fn<Fetcher>> }> {
  const connections = rows ?? [await connectionRow()];
  const calls: string[] = [];
  const fetcher = vi.fn<Fetcher>((input, init) => {
    calls.push(input);
    if (input.startsWith(configuration.supabase!.url))
      return Promise.resolve(Response.json(connections));
    return Promise.resolve(onProviderCall(init));
  });
  return { calls, fetcher };
}

function jsonBody(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
  return JSON.parse(init.body) as Record<string, unknown>;
}

function providerBody(fetcher: ReturnType<typeof vi.fn<Fetcher>>): Record<string, unknown> {
  const call = fetcher.mock.calls.find(([input]) => input.startsWith("https://api.openai.com"));
  if (call === undefined || typeof call[1]?.body !== "string") {
    throw new Error("Expected an OpenAI request body");
  }
  return JSON.parse(call[1].body) as Record<string, unknown>;
}

function messages(body: Record<string, unknown>): { role: string; content: string }[] {
  return body.messages as { role: string; content: string }[];
}

describe("request construction", () => {
  it("puts the fixed instructions in the system message and everything else in data", () => {
    const body = semanticEvaluationRequestBody(clauseOf(plan()), {
      fields: [{ field: "subject", value: "Your invoice is ready", truncated: false }],
      disclosedFields: ["subject"],
      redactions: [],
    });
    const [system, user] = messages(body);
    expect(system).toEqual({ role: "system", content: SEMANTIC_SYSTEM_INSTRUCTIONS });
    expect(user?.role).toBe("user");
    const parsed = JSON.parse(user!.content) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["question", "untrustedSourceData"]);
    expect(parsed.question).toBe("Is this message time sensitive?");
  });

  it("requests a strict structured response that admits only the contract's three keys", () => {
    const body = semanticEvaluationRequestBody(clauseOf(plan()), {
      fields: [{ field: "subject", value: "s", truncated: false }],
      disclosedFields: ["subject"],
      redactions: [],
    });
    const format = body.response_format as { json_schema: { strict: boolean; schema: unknown } };
    expect(format.json_schema.strict).toBe(true);
    expect(SEMANTIC_RESPONSE_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...SEMANTIC_RESPONSE_JSON_SCHEMA.required].sort()).toEqual([
      "confidence",
      "decision",
      "rationale",
    ]);
    expect(Object.keys(SEMANTIC_RESPONSE_JSON_SCHEMA.properties).sort()).toEqual([
      "confidence",
      "decision",
      "rationale",
    ]);
    expect(SEMANTIC_RESPONSE_JSON_SCHEMA.properties.decision.enum).toEqual(["match", "no-match"]);
  });

  it("sends no tools, so the model has nothing to select", () => {
    const body = semanticEvaluationRequestBody(clauseOf(plan()), {
      fields: [{ field: "subject", value: "s", truncated: false }],
      disclosedFields: ["subject"],
      redactions: [],
    });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.functions).toBeUndefined();
  });
});

describe("prompt-injection fixtures", () => {
  it.each(injectionFixture.cases.map((testCase) => [testCase.name, testCase] as const))(
    "%s leaves the instruction block untouched",
    (_name, testCase) => {
      const body = semanticEvaluationRequestBody(
        clauseOf(plan({ semantic: { ...clauseOf(plan()), question: "Is this urgent?" } })),
        {
          fields: [
            { field: "subject", value: String(testCase.item.subject ?? ""), truncated: false },
            { field: "body", value: String(testCase.item.body ?? ""), truncated: false },
          ],
          disclosedFields: ["subject", "body"],
          redactions: [],
        },
      );
      const [system, user] = messages(body);
      // The instruction block is byte-identical no matter what the message said. Nothing the source
      // content contains can reach the role that carries authority.
      expect(system!.content).toBe(SEMANTIC_SYSTEM_INSTRUCTIONS);
      expect(messages(body)).toHaveLength(2);

      // Injected text survives only as JSON string values inside untrustedSourceData. Parsing the
      // user message back yields exactly two keys however many braces or quotes the body contained.
      const parsed = JSON.parse(user!.content) as {
        question: string;
        untrustedSourceData: { field: string; value: string }[];
      };
      expect(Object.keys(parsed).sort()).toEqual(["question", "untrustedSourceData"]);
      expect(parsed.question).toBe("Is this urgent?");
      expect(parsed.untrustedSourceData.map((entry) => entry.field)).toEqual(["subject", "body"]);
      const bodyText = String(testCase.item.body ?? "");
      expect(parsed.untrustedSourceData[1]?.value).toBe(bodyText);
    },
  );

  it("rejects an answer that tries to name a provider, endpoint, or credential", async () => {
    const { fetcher } = await stubFetcher(() =>
      completion({
        decision: "match",
        confidence: 1,
        rationale: "approved",
        provider: "nextcloud-budget",
        endpoint: "https://attacker.example.test/ocs",
        credential: "sk_live_examplekey000000",
      }),
    );
    const outcome = await evaluateSemanticClause(clauseOf(plan()), item, {
      configuration,
      userId,
      fetcher,
    });
    expect(outcome.decision).toBe("undecided");
    expect(outcome.failureReason).toBe("invalid-response");
  });

  it("rejects an answer carrying a tool call", async () => {
    const { fetcher } = await stubFetcher(() =>
      Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({ decision: "match", confidence: 1, rationale: "ok" }),
              tool_calls: [{ id: "call_1", function: { name: "transfer", arguments: "{}" } }],
            },
          },
        ],
      }),
    );
    const outcome = await evaluateSemanticClause(clauseOf(plan()), item, {
      configuration,
      userId,
      fetcher,
    });
    expect(outcome.decision).toBe("undecided");
    expect(outcome.failureReason).toBe("invalid-response");
  });
});

describe("evaluateSemanticClause", () => {
  it("returns a decision and the disclosure metadata behind it", async () => {
    const { fetcher } = await stubFetcher(() =>
      completion({ decision: "match", confidence: 0.94, rationale: "Invoice is due next week." }),
    );
    const outcome = await evaluateSemanticClause(clauseOf(plan()), item, {
      configuration,
      userId,
      fetcher,
    });
    expect(outcome).toMatchObject({
      decision: "match",
      provider: "openai",
      purpose: "filter-semantic-clause",
      disclosed: true,
      disclosedFields: ["subject", "body"],
      confidence: 0.94,
      rationale: "Invoice is due next week.",
    });
    expect(outcome.failureReason).toBeUndefined();
  });

  it("discloses only the clause's allowlisted fields", async () => {
    const { fetcher } = await stubFetcher(() =>
      completion({ decision: "no-match", confidence: 0.99, rationale: "Not urgent." }),
    );
    await evaluateSemanticClause(
      clauseOf(plan({ semantic: { ...clauseOf(plan()), allowedFields: ["subject"] } })),
      item,
      { configuration, userId, fetcher },
    );
    const content = messages(providerBody(fetcher))[1]!.content;
    expect(content).toContain("Your invoice is ready");
    expect(content).not.toContain("billing@example.test");
    expect(content).not.toContain("quarterly invoice");
    expect(content).not.toContain("Synthetic Store");
  });

  it("holds a low-confidence answer at undecided", async () => {
    const { fetcher } = await stubFetcher(() =>
      completion({ decision: "match", confidence: 0.5, rationale: "Uncertain." }),
    );
    const outcome = await evaluateSemanticClause(clauseOf(plan()), item, {
      configuration,
      userId,
      fetcher,
    });
    expect(outcome.decision).toBe("undecided");
    expect(outcome.confidence).toBe(0.5);
    expect(outcome.failureReason).toBeUndefined();
  });

  it.each([
    [401, undefined, "credential-revoked"],
    [403, undefined, "credential-revoked"],
    [429, { error: { code: "insufficient_quota" } }, "quota-exhausted"],
    [429, { error: { code: "rate_limit_exceeded" } }, "rate-limited"],
    [500, undefined, "unavailable"],
  ])("maps HTTP %s to %s without deciding the filter", async (status, body, reason) => {
    const { fetcher } = await stubFetcher(() => Response.json(body ?? { error: {} }, { status }));
    const outcome = await evaluateSemanticClause(clauseOf(plan()), item, {
      configuration,
      userId,
      fetcher,
    });
    expect(outcome.decision).toBe("undecided");
    expect(outcome.failureReason).toBe(reason);
    expect(outcome.confidence).toBeUndefined();
    // The request did leave the runtime, so the disclosure is still recorded as having happened.
    expect(outcome.disclosed).toBe(true);
    expect(outcome.disclosedFields).toEqual(["subject", "body"]);
  });

  it("times out without deciding the filter", async () => {
    const { fetcher } = await stubFetcher(() => new Promise<Response>(() => undefined));
    const outcome = await evaluateSemanticClause(clauseOf(plan()), item, {
      configuration,
      userId,
      fetcher,
      timeoutMs: 10,
    });
    expect(outcome.decision).toBe("undecided");
    expect(outcome.failureReason).toBe("timed-out");
  });

  it("reports a missing key without contacting the provider", async () => {
    const { calls, fetcher } = await stubFetcher(() => completion({}), []);
    const outcome = await evaluateSemanticClause(clauseOf(plan()), item, {
      configuration,
      userId,
      fetcher,
    });
    expect(outcome).toMatchObject({
      decision: "undecided",
      failureReason: "credential-missing",
      disclosed: false,
      disclosedFields: [],
      redactions: [],
    });
    expect(calls.some((call) => call.startsWith("https://api.openai.com"))).toBe(false);
  });

  it("fails closed when a tenant has more than one active key", async () => {
    const row = await connectionRow();
    const { calls, fetcher } = await stubFetcher(() => completion({}), [row, row]);
    const outcome = await evaluateSemanticClause(clauseOf(plan()), item, {
      configuration,
      userId,
      fetcher,
    });
    expect(outcome.failureReason).toBe("unavailable");
    expect(calls.some((call) => call.startsWith("https://api.openai.com"))).toBe(false);
  });

  it("does not contact the provider when no allowlisted field has a value", async () => {
    const { calls, fetcher } = await stubFetcher(() => completion({}));
    const outcome = await evaluateSemanticClause(
      clauseOf(plan()),
      { source: { kind: "email" } },
      {
        configuration,
        userId,
        fetcher,
      },
    );
    expect(outcome.failureReason).toBe("no-disclosable-fields");
    expect(outcome.disclosed).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("sends the key as a bearer credential and never in the body", async () => {
    const { fetcher } = await stubFetcher(() =>
      completion({ decision: "match", confidence: 0.9, rationale: "ok" }),
    );
    await evaluateSemanticClause(clauseOf(plan()), item, { configuration, userId, fetcher });
    const call = fetcher.mock.calls.find(([input]) => input.startsWith("https://api.openai.com"));
    const headers = call![1]!.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${apiKey}`);
    expect(JSON.stringify(jsonBody(call![1]))).not.toContain(apiKey);
  });
});

describe("evaluateFilterWithSemantics", () => {
  it("never reaches the provider when the deterministic expression fails", async () => {
    const { calls, fetcher } = await stubFetcher(() => completion({}));
    const evaluation = await evaluateFilterWithSemantics(
      plan(),
      { ...item, source: { ...item.source, kind: "sms" } },
      { configuration, userId, fetcher },
    );
    expect(evaluation.decision).toBe("no-match");
    expect(evaluation.semantic).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("never reaches the provider for a plan with no semantic clause", async () => {
    const { calls, fetcher } = await stubFetcher(() => completion({}));
    const evaluation = await evaluateFilterWithSemantics(plan({ semantic: undefined }), item, {
      configuration,
      userId,
      fetcher,
    });
    expect(evaluation.decision).toBe("match");
    expect(calls).toHaveLength(0);
  });

  it("resolves an undecided plan through the semantic clause", async () => {
    const { fetcher } = await stubFetcher(() =>
      completion({ decision: "match", confidence: 0.95, rationale: "Due next week." }),
    );
    const evaluation = await evaluateFilterWithSemantics(plan(), item, {
      configuration,
      userId,
      fetcher,
    });
    expect(evaluation.decision).toBe("match");
    expect(evaluation.semantic?.disclosed).toBe(true);
    expect(evaluation.matchedPredicates).toEqual([
      { field: "source.kind", operator: "equals", path: "." },
    ]);
  });
});

describe("recordSemanticDisclosure", () => {
  it("persists metadata and no field values", async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json(disclosureId)));
    const recorded = await recordSemanticDisclosure(
      configuration,
      {
        userId,
        sourceItemId,
        outcome: {
          decision: "match",
          provider: "openai",
          model: "gpt-4.1-mini",
          purpose: "filter-semantic-clause",
          disclosedFields: ["subject", "body"],
          redactions: [{ field: "body", kind: "email-address", count: 2 }],
          disclosed: true,
          confidence: 0.94,
          rationale: "Invoice is due next week.",
        },
      },
      fetcher,
    );

    expect(recorded).toBe(disclosureId);
    const body = jsonBody(fetcher.mock.calls[0]![1]);
    expect(body).toMatchObject({
      p_user_id: userId,
      p_source_item_id: sourceItemId,
      p_filter_rule_id: null,
      p_decision: "match",
      p_disclosed: true,
      p_disclosed_fields: ["subject", "body"],
      p_confidence: 0.94,
      p_failure_reason: null,
    });
    expect(body.p_redactions).toEqual([{ field: "body", kind: "email-address", count: 2 }]);
    expect(JSON.stringify(body.p_redactions)).not.toContain("@");
  });

  it("records a failed attempt as undecided with its fixed reason", async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json(disclosureId)));
    await recordSemanticDisclosure(
      configuration,
      {
        userId,
        sourceItemId,
        outcome: {
          decision: "undecided",
          provider: "openai",
          model: "gpt-4.1-mini",
          purpose: "filter-semantic-clause",
          disclosedFields: [],
          redactions: [],
          disclosed: false,
          failureReason: "credential-revoked",
        },
      },
      fetcher,
    );
    const body = jsonBody(fetcher.mock.calls[0]![1]);
    expect(body).toMatchObject({
      p_decision: "undecided",
      p_disclosed: false,
      p_disclosed_fields: [],
      p_confidence: null,
      p_rationale: null,
      p_failure_reason: "credential-revoked",
    });
  });

  it("rejects an outcome that pairs a failure with a decision", async () => {
    const fetcher = vi.fn<Fetcher>(() => Promise.resolve(Response.json(disclosureId)));
    await expect(
      recordSemanticDisclosure(
        configuration,
        {
          userId,
          sourceItemId,
          outcome: {
            decision: "match",
            provider: "openai",
            model: "gpt-4.1-mini",
            purpose: "filter-semantic-clause",
            disclosedFields: ["subject"],
            redactions: [],
            disclosed: true,
            failureReason: "rate-limited",
          },
        },
        fetcher,
      ),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
