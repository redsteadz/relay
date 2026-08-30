import { describe, expect, it } from "vitest";

import { actionRunStatusSchema, type ActionRunStatus } from "@relay/contracts";

import {
  ACTION_DECISION_SOURCE_STATUSES,
  canClaimActionRun,
  canDecideActionRun,
  relayActionRunId,
  uuidV5,
} from "../src/action-ledger.js";

const RULE = "14000000-0000-0000-0000-000000000001";
const EVENT = "13000000-0000-0000-0000-000000000001";

describe("relayActionRunId", () => {
  it("matches the vector the database function produces", async () => {
    // The same pair is asserted against `public.relay_action_run_id` in
    // `supabase/tests/database/action_ledger.test.sql`. If either derivation changes, one of the
    // two suites fails, so the mirror cannot drift from the authority silently.
    await expect(relayActionRunId(RULE, EVENT)).resolves.toBe(
      "902e9213-0117-5bfd-829a-c4daa0000772",
    );
  });

  it("is stable across calls", async () => {
    await expect(relayActionRunId(RULE, EVENT)).resolves.toBe(await relayActionRunId(RULE, EVENT));
  });

  it("produces a version 5, variant 1 UUID", async () => {
    const id = await relayActionRunId(RULE, EVENT);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it("separates the two identifiers so no other pair collides with them", async () => {
    // Without the zero-byte separator, "ab" + "c" and "a" + "bc" would hash identically.
    const [left, right] = await Promise.all([
      uuidV5("aa8114f6-a193-573c-91f9-966134b550ca", new TextEncoder().encode("abc")),
      uuidV5(
        "aa8114f6-a193-573c-91f9-966134b550ca",
        Uint8Array.from([...new TextEncoder().encode("ab"), 0, ...new TextEncoder().encode("c")]),
      ),
    ]);
    expect(left).not.toBe(right);
  });

  it("gives a different identity to a different event or rule", async () => {
    const base = await relayActionRunId(RULE, EVENT);
    const otherEvent = await relayActionRunId(RULE, "13000000-0000-0000-0000-000000000002");
    const otherRule = await relayActionRunId("14000000-0000-0000-0000-000000000002", EVENT);
    expect(new Set([base, otherEvent, otherRule]).size).toBe(3);
  });

  it("normalizes identifier case, matching the database's lowercase uuid text", async () => {
    await expect(relayActionRunId(RULE.toUpperCase(), EVENT.toUpperCase())).resolves.toBe(
      await relayActionRunId(RULE, EVENT),
    );
  });
});

describe("decision transitions", () => {
  const statuses: ActionRunStatus[] = actionRunStatusSchema.options;

  it("allows approval only while a run is awaiting one", () => {
    const approvable = statuses.filter((status) => canDecideActionRun(status, "approve"));
    expect(approvable).toEqual(["awaiting-approval"]);
  });

  it("allows cancellation until the run starts", () => {
    const cancellable = statuses.filter((status) => canDecideActionRun(status, "cancel"));
    expect(cancellable).toEqual(["proposed", "awaiting-approval", "approved"]);
  });

  it("never permits a decision on a running or terminal run", () => {
    for (const status of ["running", "succeeded", "failed", "cancelled"] as const) {
      expect(canDecideActionRun(status, "approve")).toBe(false);
      expect(canDecideActionRun(status, "cancel")).toBe(false);
    }
  });

  it("names only statuses the contract defines", () => {
    for (const sources of Object.values(ACTION_DECISION_SOURCE_STATUSES)) {
      for (const status of sources) {
        expect(actionRunStatusSchema.safeParse(status).success).toBe(true);
      }
    }
  });
});

describe("workflow eligibility", () => {
  it("admits only an approved run", () => {
    const claimable = actionRunStatusSchema.options.filter(canClaimActionRun);
    expect(claimable).toEqual(["approved"]);
  });

  it("refuses to start from an undecided run", () => {
    expect(canClaimActionRun("proposed")).toBe(false);
    expect(canClaimActionRun("awaiting-approval")).toBe(false);
  });
});
