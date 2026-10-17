import { filterPlanSchema, type FilterPlan } from "@relay/contracts";
import { SEMANTIC_SYSTEM_INSTRUCTIONS } from "@relay/domain";
import { describe, expect, it, vi } from "vitest";

import {
  deviceSemanticProbeExplanation,
  evaluateDeviceSemanticClause,
  probeDeviceSemanticEndpoint,
  type DeviceSemanticRefusal,
} from "./device-semantic";

const CLAUSE = {
  allowedFields: ["subject", "sender"] as const,
  minimumConfidence: 0.8,
  question: "is this junk marketing?",
};

function clause(overrides: Partial<FilterPlan["semantic"]> = {}) {
  const plan = filterPlanSchema.parse({
    schemaVersion: 1,
    compilerVersion: 1,
    intent: "synthetic intent",
    deterministic: { field: "source.applicationId", operator: "equals", value: "com.courier.app" },
    semantic: { ...CLAUSE, ...overrides },
  });
  return plan.semantic as NonNullable<FilterPlan["semantic"]>;
}

const CONFIG = {
  baseUrl: "http://192.168.1.10:11434/v1",
  model: "llama3.2:3b",
  responseFormat: "json-object" as const,
};

const ITEM = {
  sender: "offers@courier.example",
  source: { applicationId: "com.courier.app", kind: "notification" },
  subject: "Save 50% today, call 555-123-4567",
};

/** A chat-completions reply carrying one stopped choice. */
function reply(decision: "match" | "no-match", confidence: number): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({ confidence, decision, rationale: "looks like an offer" }),
          },
        },
      ],
    }),
    { status: 200 },
  );
}

describe("deciding on the device", () => {
  it("returns the model's decision when it clears the confidence threshold", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply("match", 0.95));
    const result = await evaluateDeviceSemanticClause(clause(), ITEM, CONFIG, { fetcher });
    expect(result.decision).toBe("match");
    expect(result.refusal).toBeUndefined();
  });

  // The threshold is the clause's, applied by the shared `resolveSemanticDecision`, so a confident
  // model and a hesitant one are not treated alike.
  it("is undecided when the model is below the clause's confidence", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply("match", 0.4));
    const result = await evaluateDeviceSemanticClause(clause(), ITEM, CONFIG, { fetcher });
    expect(result.decision).toBe("undecided");
  });

  it("posts to the configured endpoint's chat-completions route", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply("no-match", 0.9));
    await evaluateDeviceSemanticClause(clause(), ITEM, CONFIG, { fetcher });
    expect(fetcher.mock.calls[0]?.[0]).toBe("http://192.168.1.10:11434/v1/chat/completions");
  });

  // A local server usually wants no credential, and an unexpected empty bearer is a good way to be
  // refused by one that does not.
  it("sends no authorization header when no key is configured", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply("match", 0.9));
    await evaluateDeviceSemanticClause(clause(), ITEM, CONFIG, { fetcher });
    const headers = (fetcher.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();

    const withKey = vi.fn().mockResolvedValue(reply("match", 0.9));
    await evaluateDeviceSemanticClause(
      clause(),
      ITEM,
      { ...CONFIG, apiKey: "local-key" },
      {
        fetcher: withKey,
      },
    );
    const keyed = (withKey.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(keyed.authorization).toBe("Bearer local-key");
  });
});

describe("what leaves the device", () => {
  async function sentBody(item: Record<string, unknown>, clauseOverrides = {}) {
    const fetcher = vi.fn().mockResolvedValue(reply("match", 0.9));
    await evaluateDeviceSemanticClause(clause(clauseOverrides), item, CONFIG, { fetcher });
    return JSON.parse((fetcher.mock.calls[0]?.[1] as RequestInit).body as string) as {
      messages: { content: string; role: string }[];
    };
  }

  // The instruction block is a security boundary, not decoration: it is what states that captured
  // content is data rather than instruction. The device must send the same one the server does.
  it("sends the shared instruction block verbatim", async () => {
    const body = await sentBody(ITEM);
    expect(body.messages[0]).toStrictEqual({
      content: SEMANTIC_SYSTEM_INSTRUCTIONS,
      role: "system",
    });
  });

  // The redaction is the shared `minimizeSemanticDisclosure`, so a phone number in a title is
  // removed before the request is built rather than by anything in this module.
  it("redacts before sending", async () => {
    const body = await sentBody(ITEM);
    const user = body.messages[1]?.content ?? "";
    expect(user).not.toContain("555-123-4567");
    expect(user).toContain("[redacted:");
  });

  // A field the clause did not ask for is never disclosed, whatever the item holds.
  it("sends only the fields the clause allowed", async () => {
    const body = await sentBody(
      { ...ITEM, body: "a body nobody asked for" },
      { allowedFields: ["subject"] },
    );
    const user = body.messages[1]?.content ?? "";
    expect(user).not.toContain("a body nobody asked for");
    expect(user).not.toContain("offers@courier.example");
    expect(user).toContain("subject");
  });

  // The question and the captured content are separated by JSON encoding, so content cannot
  // terminate its own field and continue as message structure.
  it("keeps the question and the captured data in separate keys", async () => {
    const body = await sentBody(ITEM);
    const user = JSON.parse(body.messages[1]?.content ?? "{}") as {
      question: string;
      untrustedSourceData: unknown[];
    };
    expect(user.question).toBe("is this junk marketing?");
    expect(Array.isArray(user.untrustedSourceData)).toBe(true);
  });
});

describe("every failure leaves the capture alone", () => {
  it.each<[string, unknown, DeviceSemanticRefusal]>([
    ["no configuration", undefined, "not-configured"],
    ["a configuration missing a model", { baseUrl: CONFIG.baseUrl }, "not-configured"],
    // The strict policy still applies to everything it should: a credential in the URL would be
    // smuggled into every log and disclosure naming the endpoint.
    [
      "an endpoint with embedded credentials",
      { ...CONFIG, baseUrl: "http://u:p@192.168.1.10:11434/v1" },
      "endpoint-invalid",
    ],
    [
      "a public endpoint over plain http",
      { ...CONFIG, baseUrl: "http://api.openai.com/v1" },
      "endpoint-invalid",
    ],
  ])("is undecided for %s", async (_label, config, refusal) => {
    const fetcher = vi.fn();
    const result = await evaluateDeviceSemanticClause(clause(), ITEM, config, { fetcher });
    expect(result).toStrictEqual({ decision: "undecided", refusal });
    // Nothing was sent, so nothing may claim a host it did not contact.
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.disclosure).toBeUndefined();
  });

  it.each<[string, () => Promise<Response>, DeviceSemanticRefusal]>([
    [
      "an unreachable endpoint",
      () => Promise.reject(new TypeError("Network request failed")),
      "endpoint-unreachable",
    ],
    [
      "a refusing endpoint",
      () => Promise.resolve(new Response("nope", { status: 401 })),
      "rejected",
    ],
    [
      "a non-JSON reply",
      () => Promise.resolve(new Response("not json", { status: 200 })),
      "invalid-response",
    ],
    [
      "a reply with no stopped choice",
      () => Promise.resolve(new Response(JSON.stringify({ choices: [] }), { status: 200 })),
      "invalid-response",
    ],
    [
      "a reply that refused",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ finish_reason: "stop", message: { refusal: "no" } }] }),
            { status: 200 },
          ),
        ),
      "invalid-response",
    ],
    [
      "an oversized reply",
      () => Promise.resolve(new Response("x".repeat(40_000), { status: 200 })),
      "response-too-large",
    ],
  ])("is undecided for %s", async (_label, respond, refusal) => {
    const result = await evaluateDeviceSemanticClause(clause(), ITEM, CONFIG, { fetcher: respond });
    expect(result.decision).toBe("undecided");
    expect(result.refusal).toBe(refusal);
  });

  // A request that left names the endpoint it reached, so the disclosure history can say where data
  // actually went even when the answer was useless.
  it("records the endpoint it contacted even when the reply was unusable", async () => {
    const result = await evaluateDeviceSemanticClause(clause(), ITEM, CONFIG, {
      fetcher: () => Promise.resolve(new Response("not json", { status: 200 })),
    });
    expect(result.disclosure?.host).toBe("192.168.1.10");
    expect(result.disclosure?.model).toBe("llama3.2:3b");
  });

  it("gives up rather than waiting indefinitely", async () => {
    const result = await evaluateDeviceSemanticClause(clause(), ITEM, CONFIG, {
      fetcher: (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
      timeoutMs: 10,
    });
    expect(result.refusal).toBe("timed-out");
  });
});

/*
  Testing an address before trusting it.

  Every way of configuring this wrongly used to produce the same non-event: a rule that quietly
  never decided. Twice in a row that cost a build cycle and a round trip to work out which of a
  wrong path, a wrong key and a wrong model name it was. The status code is what separates them,
  so these assert that it survives to the reader.
*/
describe("testing a model endpoint", () => {
  const SYSTEM_ONE = {
    ...CONFIG,
    baseUrl: "https://openrouter.ai/api/v1",
    model: "typesafe/jev-1.14",
    protocol: "system-one" as const,
  };

  it("asks a decision engine at /systemone and a chat model at /chat/completions", async () => {
    const seen: string[] = [];
    const fetcher = vi.fn((url: string) => {
      seen.push(url);
      return Promise.resolve(new Response("{}", { status: 200 }));
    });

    await probeDeviceSemanticEndpoint(SYSTEM_ONE, { fetcher });
    await probeDeviceSemanticEndpoint(CONFIG, { fetcher });
    expect(seen).toStrictEqual([
      "https://openrouter.ai/api/v1/systemone",
      "http://192.168.1.10:11434/v1/chat/completions",
    ]);
  });

  // The whole reason a probe exists rather than a second evaluation call.
  it("keeps the status code instead of collapsing every failure to one refusal", async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response("not found", { status: 404 })));
    const probe = await probeDeviceSemanticEndpoint(SYSTEM_ONE, { fetcher });
    expect(probe).toStrictEqual({ decided: false, httpStatus: 404, refusal: "rejected" });
  });

  // A 404 is the signature of `openrouter.ai/v1` instead of `openrouter.ai/api/v1`, which is what
  // the field hint used to steer a reader towards.
  it("names the path, not the model, when nothing answers there", () => {
    const text = deviceSemanticProbeExplanation({
      decided: false,
      httpStatus: 404,
      refusal: "rejected",
    });
    expect(text).toContain("/api/v1");
    expect(text).not.toContain("refused");
  });

  it("separates a bad key from a bad request shape", () => {
    expect(
      deviceSemanticProbeExplanation({ decided: false, httpStatus: 401, refusal: "rejected" }),
    ).toContain("credential");
    expect(
      deviceSemanticProbeExplanation({ decided: false, httpStatus: 400, refusal: "rejected" }),
    ).toContain("model name");
  });

  it("reports a decision engine that answered as working", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ answers: { relayFilterMatch: { noul: 0.93, type: "noul" } } }),
          {
            status: 200,
          },
        ),
      ),
    );
    const probe = await probeDeviceSemanticEndpoint(SYSTEM_ONE, { fetcher });
    expect(probe.decided).toBe(true);
    expect(deviceSemanticProbeExplanation(probe)).toContain("answered correctly");
  });

  // 200 with a reply that is not a decision is the "wrong kind of model selected" case, and must
  // not read as success.
  it("refuses a 200 that is not a decision", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ hello: "world" }), { status: 200 })),
    );
    const probe = await probeDeviceSemanticEndpoint(SYSTEM_ONE, { fetcher });
    expect(probe.decided).toBe(false);
    expect(probe.refusal).toBe("invalid-response");
  });

  // A probe must never carry a real capture to an address that has not been shown to work.
  it("asks about a synthetic message, never a real one", async () => {
    let body = "";
    const fetcher = vi.fn((_url: string, init?: RequestInit) => {
      body = typeof init?.body === "string" ? init.body : "";
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    await probeDeviceSemanticEndpoint(SYSTEM_ONE, { fetcher });
    expect(body).not.toContain("Save 50% today");
    expect(body).not.toContain("offers@courier.example");
    expect(body).toContain("parcel");
  });

  it("reports an unreachable endpoint without a status", async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error("network down")));
    const probe = await probeDeviceSemanticEndpoint(SYSTEM_ONE, { fetcher });
    expect(probe).toStrictEqual({ decided: false, refusal: "endpoint-unreachable" });
    expect(deviceSemanticProbeExplanation(probe)).toContain("could not reach");
  });
});
