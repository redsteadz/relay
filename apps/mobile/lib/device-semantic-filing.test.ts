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

const { resolveAwaitingModel } = await import("./device-semantic-filing");
const { deviceDisclosures } = await import("./local-store/disclosures");
const { loadNodeSqlite, nodeSqliteLocalStore } = await import("./local-store/node-sqlite");

const sqlite = await loadNodeSqlite();

const TENANT = "70000000-0000-4000-8000-000000000001";
const RULE = "70300000-0000-4000-8000-000000000001";
const ITEM = "70100000-0000-4000-8000-000000000001";

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

function awaiting(sourceItemId = ITEM, filterRuleId = RULE) {
  return {
    capture: {
      category: undefined,
      content: { body: undefined, subject: "Save 50% today" },
      factValues: {},
      source: {
        applicationId: "com.courier.app",
        kind: "notification",
        occurredAt: "2026-10-08T09:00:00.000Z",
        sender: undefined,
        subject: "Save 50% today",
        threadId: undefined,
      },
      sourceItemId,
    },
    filterRuleId,
  };
}

function pendingFor(sourceItemId = ITEM, filterRuleId = RULE) {
  return [awaiting(sourceItemId, filterRuleId)];
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

describe("resolving what the deterministic pass could not decide", () => {
  it("returns the answer keyed by capture and rule", async () => {
    const { close, store: database } = store();
    try {
      const result = await resolveAwaitingModel(pendingFor(), [semanticRule()], {
        config: CONFIG,
        database,
        fetcher: () => Promise.resolve(reply("match", 0.95)),
        tenantId: TENANT,
      });
      expect(result.evaluated).toBe(1);
      expect(result.decisions.get(ITEM)?.get(RULE)).toBe("match");
    } finally {
      close();
    }
  });

  // A failure contributes `undecided`, which `classifyCapture` treats as no answer, so the capture
  // stays blocked rather than being filed on a guess.
  it("contributes undecided when the model cannot be reached", async () => {
    const { close, store: database } = store();
    try {
      const result = await resolveAwaitingModel(pendingFor(), [semanticRule()], {
        config: CONFIG,
        database,
        fetcher: () => Promise.reject(new TypeError("Network request failed")),
        tenantId: TENANT,
      });
      expect(result.decisions.get(ITEM)?.get(RULE)).toBe("undecided");
    } finally {
      close();
    }
  });

  // A disclosure history that lists only successes does not say what was attempted.
  it("records a disclosure for every evaluation, successful or not", async () => {
    const { close, store: database } = store();
    try {
      await resolveAwaitingModel(pendingFor(), [semanticRule()], {
        config: CONFIG,
        database,
        fetcher: () => Promise.resolve(new Response("not json", { status: 200 })),
        tenantId: TENANT,
      });
      const [row] = await deviceDisclosures(database, TENANT);
      expect(row?.failure_reason).toBe("invalid-response");
      expect(row?.endpoint_host).toBe("192.168.1.10");
      expect(row?.disclosed).toBe(1);
    } finally {
      close();
    }
  });

  it("asks nothing and discloses nothing when no endpoint is configured", async () => {
    const { close, store: database } = store();
    try {
      const fetcher = vi.fn();
      const result = await resolveAwaitingModel(pendingFor(), [semanticRule()], {
        config: undefined,
        database,
        fetcher,
        tenantId: TENANT,
      });
      expect(result.evaluated).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
      expect(await deviceDisclosures(database, TENANT)).toStrictEqual([]);
    } finally {
      close();
    }
  });

  // A capture can be blocked by something other than a resolvable clause, and a rule can have gone
  // away since the pass ran. Neither is an error; there is simply nothing to ask.
  it("skips a capture whose rule is gone", async () => {
    const { close, store: database } = store();
    try {
      const fetcher = vi.fn();
      const result = await resolveAwaitingModel(
        pendingFor(ITEM, "70300000-0000-4000-8000-0000000000ff"),
        [semanticRule()],
        {
          config: CONFIG,
          database,
          fetcher,
          tenantId: TENANT,
        },
      );
      expect(result.evaluated).toBe(0);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      close();
    }
  });

  // A cold start with a backlog must not fire a request per capture at a model that answers in
  // seconds. The rest are picked up next pass.
  it("bounds how many clauses one pass resolves", async () => {
    const { close, store: database } = store();
    try {
      const fetcher = vi.fn(() => Promise.resolve(reply("match", 0.9)));
      const pending = Array.from({ length: 5 }, (_entry, index) =>
        awaiting(`70100000-0000-4000-8000-00000000000${index.toString()}`),
      );

      const result = await resolveAwaitingModel(pending, [semanticRule()], {
        config: CONFIG,
        database,
        fetcher,
        limit: 2,
        tenantId: TENANT,
      });
      expect(result.evaluated).toBe(2);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      close();
    }
  });
});
