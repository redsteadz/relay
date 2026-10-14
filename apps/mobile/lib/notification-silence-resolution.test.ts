import type { ClassifiableRule } from "@relay/domain";
import { filterPlanSchema } from "@relay/contracts";
import { describe, expect, it, vi } from "vitest";

vi.mock("expo-crypto", () => {
  let counter = 0;
  return {
    randomUUID: () => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
    },
  };
});

const { resolvePendingSilences } = await import("./notification-silence-resolution");
const { deviceDisclosures } = await import("./local-store/disclosures");
const { loadNodeSqlite, nodeSqliteLocalStore } = await import("./local-store/node-sqlite");

const sqlite = await loadNodeSqlite();

const TENANT = "70000000-0000-4000-8000-000000000001";
const RULE = "70300000-0000-4000-8000-000000000001";
const ENVELOPE = "70100000-0000-4000-8000-000000000001";

const CONFIG = {
  baseUrl: "http://192.168.1.10:11434/v1",
  model: "llama3.2:3b",
  responseFormat: "json-object" as const,
};

function semanticRule(id = RULE): ClassifiableRule {
  return {
    categoryId: "70400000-0000-4000-8000-000000000001",
    id,
    plan: filterPlanSchema.parse({
      schemaVersion: 1,
      compilerVersion: 1,
      intent: "junk from the courier app",
      deterministic: {
        field: "source.applicationId",
        operator: "equals",
        value: "com.courier.app",
      },
      semantic: {
        question: "is this junk marketing?",
        minimumConfidence: 0.8,
        allowedFields: ["subject"],
      },
    }),
  };
}

function candidate(envelopeId = ENVELOPE, filterRuleId = RULE) {
  return { applicationId: "com.courier.app", envelopeId, filterRuleId };
}

function contentFor(...envelopeIds: string[]) {
  return new Map(envelopeIds.map((id) => [id, { subject: "Save 50% today" }]));
}

function reply(decision: "match" | "no-match", confidence: number): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { content: JSON.stringify({ confidence, decision, rationale: "an offer" }) },
        },
      ],
    }),
    { status: 200 },
  );
}

function store() {
  if (sqlite === undefined) throw new Error("node:sqlite unavailable");
  return nodeSqliteLocalStore(sqlite);
}

/** Stands in for the native call, recording what it was handed. */
function device(verdict: string | null = "snoozed") {
  const calls: { envelopeId: string; matched: boolean }[] = [];
  return {
    calls,
    resolve: (envelopeId: string, matched: boolean) => {
      calls.push({ envelopeId, matched });
      return Promise.resolve(verdict);
    },
  };
}

describe("finishing a deferred quiet decision", () => {
  it("hands a match to the device and reports what it recorded", async () => {
    const { close, store: database } = store();
    const native = device("snoozed");
    try {
      const result = await resolvePendingSilences([candidate()], [semanticRule()], {
        config: CONFIG,
        content: contentFor(ENVELOPE),
        database,
        fetcher: () => Promise.resolve(reply("match", 0.95)),
        resolve: native.resolve,
        tenantId: TENANT,
      });
      expect(result.evaluated).toBe(1);
      expect(native.calls).toStrictEqual([{ envelopeId: ENVELOPE, matched: true }]);
      expect(result.recorded.get(ENVELOPE)).toBe("snoozed");
    } finally {
      close();
    }
  });

  // A model saying no is an answer, and closing the candidate as a miss is what stops it being asked
  // again on every pass for the next thirty days.
  it("hands an answer of no to the device as a miss", async () => {
    const { close, store: database } = store();
    const native = device("no-match");
    try {
      await resolvePendingSilences([candidate()], [semanticRule()], {
        config: CONFIG,
        content: contentFor(ENVELOPE),
        database,
        fetcher: () => Promise.resolve(reply("no-match", 0.95)),
        resolve: native.resolve,
        tenantId: TENANT,
      });
      expect(native.calls).toStrictEqual([{ envelopeId: ENVELOPE, matched: false }]);
    } finally {
      close();
    }
  });

  // The case this whole design exists to get right. No answer is not an answer of no: handing
  // `undecided` over as `matched: false` would record a miss the model never reported and close a
  // candidate that deserves another pass.
  it("leaves the candidate alone when the model cannot be reached", async () => {
    const { close, store: database } = store();
    const native = device();
    try {
      const result = await resolvePendingSilences([candidate()], [semanticRule()], {
        config: CONFIG,
        content: contentFor(ENVELOPE),
        database,
        fetcher: () => Promise.reject(new TypeError("Network request failed")),
        resolve: native.resolve,
        tenantId: TENANT,
      });
      expect(result.evaluated).toBe(1);
      expect(native.calls).toStrictEqual([]);
      expect(result.recorded.size).toBe(0);
    } finally {
      close();
    }
  });

  // Same for a model that answered below the clause's own confidence threshold: `resolveSemanticDecision`
  // reports `undecided`, and a notification is left alone rather than quieted on a guess.
  it("leaves the candidate alone when the answer is not confident enough", async () => {
    const { close, store: database } = store();
    const native = device();
    try {
      await resolvePendingSilences([candidate()], [semanticRule()], {
        config: CONFIG,
        content: contentFor(ENVELOPE),
        database,
        fetcher: () => Promise.resolve(reply("match", 0.4)),
        resolve: native.resolve,
        tenantId: TENANT,
      });
      expect(native.calls).toStrictEqual([]);
    } finally {
      close();
    }
  });

  // A request that happened and was not recorded is the failure that matters here: something left
  // the device that the disclosure history would not account for.
  it("records a disclosure before acting, successful or not", async () => {
    const { close, store: database } = store();
    try {
      await resolvePendingSilences([candidate()], [semanticRule()], {
        config: CONFIG,
        content: contentFor(ENVELOPE),
        database,
        fetcher: () => Promise.resolve(new Response("not json", { status: 200 })),
        resolve: device().resolve,
        tenantId: TENANT,
      });
      const [row] = await deviceDisclosures(database, TENANT);
      expect(row?.failure_reason).toBe("invalid-response");
      expect(row?.endpoint_host).toBe("192.168.1.10");
      expect(row?.source_item_id).toBe(ENVELOPE);
      expect(row?.filter_rule_id).toBe(RULE);
    } finally {
      close();
    }
  });

  it("asks nothing when no endpoint is configured", async () => {
    const { close, store: database } = store();
    try {
      const fetcher = vi.fn();
      const native = device();
      const result = await resolvePendingSilences([candidate()], [semanticRule()], {
        config: undefined,
        content: contentFor(ENVELOPE),
        database,
        fetcher,
        resolve: native.resolve,
        tenantId: TENANT,
      });
      expect(result.evaluated).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
      expect(native.calls).toStrictEqual([]);
    } finally {
      close();
    }
  });

  // Answering for a rule that no longer exists would be answering a question nobody asked. The
  // device declines such a candidate on its own terms.
  it("skips a candidate whose rule is gone", async () => {
    const { close, store: database } = store();
    try {
      const fetcher = vi.fn();
      const native = device();
      const result = await resolvePendingSilences(
        [candidate(ENVELOPE, "70300000-0000-4000-8000-0000000000ff")],
        [semanticRule()],
        {
          config: CONFIG,
          content: contentFor(ENVELOPE),
          database,
          fetcher,
          resolve: native.resolve,
          tenantId: TENANT,
        },
      );
      expect(result.evaluated).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
      expect(native.calls).toStrictEqual([]);
    } finally {
      close();
    }
  });

  // Retention is bounded by age and size, so a candidate can outlive its own content. Inventing an
  // empty subject would answer "is this junk?" about a notification nobody can read.
  it("skips a candidate whose content is gone", async () => {
    const { close, store: database } = store();
    try {
      const fetcher = vi.fn();
      const result = await resolvePendingSilences([candidate()], [semanticRule()], {
        config: CONFIG,
        content: new Map(),
        database,
        fetcher,
        resolve: device().resolve,
        tenantId: TENANT,
      });
      expect(result.evaluated).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  // The device owns the verdict. `null` means the candidate was already resolved, expired, or
  // cleared by a withdrawal, and this reports nothing rather than inventing an outcome.
  it("reports nothing for a candidate the device had already closed", async () => {
    const { close, store: database } = store();
    try {
      const result = await resolvePendingSilences([candidate()], [semanticRule()], {
        config: CONFIG,
        content: contentFor(ENVELOPE),
        database,
        fetcher: () => Promise.resolve(reply("match", 0.95)),
        resolve: device(null).resolve,
        tenantId: TENANT,
      });
      expect(result.evaluated).toBe(1);
      expect(result.recorded.size).toBe(0);
    } finally {
      close();
    }
  });

  // One candidate failing must not strand the rest: this runs beside work whose job is to make
  // progress where it can.
  it("carries on when the device call for one candidate fails", async () => {
    const { close, store: database } = store();
    const second = "70100000-0000-4000-8000-000000000002";
    try {
      const seen: string[] = [];
      const result = await resolvePendingSilences(
        [candidate(), candidate(second)],
        [semanticRule()],
        {
          config: CONFIG,
          content: contentFor(ENVELOPE, second),
          database,
          fetcher: () => Promise.resolve(reply("match", 0.95)),
          resolve: (envelopeId) => {
            seen.push(envelopeId);
            return envelopeId === ENVELOPE
              ? Promise.reject(new Error("generation_stale"))
              : Promise.resolve("dismissed");
          },
          tenantId: TENANT,
        },
      );
      expect(seen).toStrictEqual([ENVELOPE, second]);
      expect(result.recorded.get(second)).toBe("dismissed");
      expect(result.recorded.has(ENVELOPE)).toBe(false);
    } finally {
      close();
    }
  });
});
