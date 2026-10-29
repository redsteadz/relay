import { describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (key: string) => Promise.resolve(storage.get(key) ?? null),
    removeItem: (key: string) => {
      storage.delete(key);
      return Promise.resolve();
    },
    setItem: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    },
  },
}));

const {
  attemptFromResult,
  clearDeviceModelJournal,
  DEVICE_MODEL_JOURNAL_LIMIT,
  EMPTY_PASS_COUNTS,
  journaledDeviceModelPass,
  probeDeviceModel,
  readDeviceModelJournal,
  recordDeviceModelPass,
  subscribeDeviceModelJournal,
} = await import("./device-semantic-diagnostics");

const TENANT = "70000000-0000-4000-8000-000000000001";

const CONFIG = {
  baseUrl: "https://api.typesafe.ai/v1",
  model: "jev-latest",
  protocol: "system-one" as const,
  responseFormat: "json-object" as const,
};

function report(overrides: Partial<Parameters<typeof recordDeviceModelPass>[1]> = {}) {
  return {
    attempts: [],
    counts: EMPTY_PASS_COUNTS,
    durationMs: 5,
    kind: "quiet" as const,
    outcome: "no-candidates" as const,
    startedAt: "2026-10-23T10:00:00.000Z",
    trigger: "foreground" as const,
    ...overrides,
  };
}

describe("the journal", () => {
  it("keeps the newest pass first and drops the oldest past the limit", async () => {
    await clearDeviceModelJournal(TENANT);
    for (let index = 0; index <= DEVICE_MODEL_JOURNAL_LIMIT; index += 1) {
      await recordDeviceModelPass(
        TENANT,
        report({ startedAt: `2026-10-23T10:00:${String(index).padStart(2, "0")}.000Z` }),
      );
    }
    const journal = await readDeviceModelJournal(TENANT);
    expect(journal).toHaveLength(DEVICE_MODEL_JOURNAL_LIMIT);
    expect(journal[0]?.startedAt).toBe("2026-10-23T10:00:12.000Z");
  });

  it("is scoped to the tenant", async () => {
    await clearDeviceModelJournal(TENANT);
    await recordDeviceModelPass(TENANT, report());
    expect(await readDeviceModelJournal("70000000-0000-4000-8000-000000000002")).toStrictEqual([]);
  });

  it("tells a subscriber after every write", async () => {
    const seen = vi.fn();
    const unsubscribe = subscribeDeviceModelJournal(TENANT, seen);
    await recordDeviceModelPass(TENANT, report());
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
    await recordDeviceModelPass(TENANT, report());
    expect(seen).toHaveBeenCalledTimes(1);
  });

  // A journal written by a different build is not worth failing over; the next write replaces it.
  it("reads an unparseable journal as empty", async () => {
    storage.set(`relay-model-journal.${TENANT}`, "{not json");
    expect(await readDeviceModelJournal(TENANT)).toStrictEqual([]);
  });
});

describe("a journaled pass", () => {
  it("records what the pass reported, with its timing and trigger", async () => {
    await clearDeviceModelJournal(TENANT);
    const result = await journaledDeviceModelPass(TENANT, "quiet", "background", () =>
      Promise.resolve({
        attempts: [],
        counts: { ...EMPTY_PASS_COUNTS, candidates: 3 },
        outcome: "shade-unreadable" as const,
        result: 0,
      }),
    );
    expect(result).toBe(0);
    const [entry] = await readDeviceModelJournal(TENANT);
    expect(entry).toMatchObject({
      counts: { candidates: 3 },
      kind: "quiet",
      outcome: "shade-unreadable",
      trigger: "background",
    });
  });

  // A pass that threw is still a pass that ran. Recording it as `failed` is what keeps the journal
  // honest about a gap, and rethrowing is what keeps the caller's own terminal log.
  it("records a thrown pass as failed and rethrows", async () => {
    await clearDeviceModelJournal(TENANT);
    await expect(
      journaledDeviceModelPass(TENANT, "quiet", "foreground", () =>
        Promise.reject(new Error("boom")),
      ),
    ).rejects.toThrow("boom");
    const [entry] = await readDeviceModelJournal(TENANT);
    expect(entry?.outcome).toBe("failed");
  });
});

describe("the entry for one attempt", () => {
  it("keeps only the allowlisted fields", () => {
    const attempt = attemptFromResult({
      decision: "undecided",
      disclosure: {
        disclosure: { disclosedFields: ["subject"], fields: [], redactions: [] },
        host: "api.typesafe.ai",
        model: "jev-latest",
      },
      durationMs: 321,
      protocol: "system-one",
      refusal: "rejected",
      statusCode: 401,
    });
    expect(attempt).toStrictEqual({
      decision: "undecided",
      durationMs: 321,
      host: "api.typesafe.ai",
      model: "jev-latest",
      protocol: "system-one",
      refusal: "rejected",
      statusCode: 401,
    });
  });
});

describe("the probe", () => {
  it("asks the configured endpoint one synthetic question and journals the answer", async () => {
    await clearDeviceModelJournal(TENANT);
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ answers: { relayFilterMatch: { noul: 0.96 } } }), {
        status: 200,
      }),
    );
    const result = await probeDeviceModel(TENANT, CONFIG, { fetcher });
    expect(result.decision).toBe("match");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.typesafe.ai/v1/systemone");
    // Nothing a reader received: the body is the synthetic message and nothing else.
    const body = (fetcher.mock.calls[0]?.[1] as RequestInit).body as string;
    expect(body).toContain("Weekend sale");
    const [entry] = await readDeviceModelJournal(TENANT);
    expect(entry).toMatchObject({
      attempts: [{ decision: "match", host: "api.typesafe.ai", protocol: "system-one" }],
      kind: "probe",
      outcome: "evaluated",
      trigger: "manual",
    });
  });

  it("reports a refusal with its status, so a wrong key reads as a wrong key", async () => {
    await clearDeviceModelJournal(TENANT);
    const result = await probeDeviceModel(TENANT, CONFIG, {
      fetcher: () => Promise.resolve(new Response("nope", { status: 401 })),
    });
    expect(result).toMatchObject({ refusal: "rejected", statusCode: 401 });
    const [entry] = await readDeviceModelJournal(TENANT);
    expect(entry?.attempts[0]).toMatchObject({ refusal: "rejected", statusCode: 401 });
  });

  it("says when there is no model to ask", async () => {
    await clearDeviceModelJournal(TENANT);
    const fetcher = vi.fn();
    const result = await probeDeviceModel(TENANT, undefined, { fetcher });
    expect(result.refusal).toBe("not-configured");
    expect(fetcher).not.toHaveBeenCalled();
    const [entry] = await readDeviceModelJournal(TENANT);
    expect(entry?.outcome).toBe("not-configured");
  });
});
