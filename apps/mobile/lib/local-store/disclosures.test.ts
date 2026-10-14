import { describe, expect, it } from "vitest";

import type { DeviceSemanticResult } from "../device-semantic";
import type { LocalStore } from "./database";
import { deviceDisclosures, recordDeviceDisclosure } from "./disclosures";
import { loadNodeSqlite, nodeSqliteLocalStore } from "./node-sqlite";

const sqlite = await loadNodeSqlite();

/**
 * A real SQLite behind the store contract, already migrated, so the table's own CHECK constraints
 * are the real ones rather than a fixture's idea of them.
 */
function store(): { close: () => void; store: LocalStore } {
  if (sqlite === undefined) throw new Error("node:sqlite unavailable");
  return nodeSqliteLocalStore(sqlite);
}

const TENANT = "70000000-0000-4000-8000-000000000001";
const ITEM = "70100000-0000-4000-8000-000000000001";
const RULE = "70300000-0000-4000-8000-000000000001";

/** What the evaluator returns when a request left and was answered. */
function answered(decision: "match" | "no-match"): DeviceSemanticResult {
  return {
    decision,
    disclosure: {
      disclosure: {
        disclosedFields: ["subject", "sender"],
        fields: [
          { field: "subject", truncated: false, value: "Save 50% today" },
          { field: "sender", truncated: false, value: "[redacted:email-address]" },
        ],
        redactions: [{ count: 1, field: "sender", kind: "email-address" }],
      },
      host: "192.168.1.10",
      model: "llama3.2:3b",
    },
  };
}

describe("recording what the device disclosed", () => {
  it("records the endpoint that answered, not an assumed provider", async () => {
    const { close, store: database } = store();
    try {
      await recordDeviceDisclosure(database, TENANT, {
        filterRuleId: RULE,
        id: "d1",
        result: answered("match"),
        sourceItemId: ITEM,
      });
      const [row] = await deviceDisclosures(database, TENANT);
      // A device endpoint is frequently a machine on the reader's own network. History that implied
      // OpenAI would be wrong in the direction that matters.
      expect(row?.endpoint_host).toBe("192.168.1.10");
      expect(row?.model).toBe("llama3.2:3b");
      expect(row?.decision).toBe("match");
      expect(row?.disclosed).toBe(1);
    } finally {
      close();
    }
  });

  // The whole privacy property of this table: names and counts, never values. A value here would
  // make the store a second home for captured text.
  it("records field names and redaction counts, never the values", async () => {
    const { close, store: database } = store();
    try {
      await recordDeviceDisclosure(database, TENANT, {
        filterRuleId: RULE,
        id: "d1",
        result: answered("match"),
        sourceItemId: ITEM,
      });
      const [row] = await deviceDisclosures(database, TENANT);
      expect(JSON.parse(row?.disclosed_fields ?? "[]")).toStrictEqual(["subject", "sender"]);
      expect(JSON.parse(row?.redactions ?? "[]")).toStrictEqual([
        { count: 1, field: "sender", kind: "email-address" },
      ]);

      const serialized = JSON.stringify(row);
      expect(serialized).not.toContain("Save 50% today");
      expect(serialized).not.toContain("redacted:email-address");
    } finally {
      close();
    }
  });

  // An attempt that sent nothing must be distinguishable from one that sent data and learned
  // nothing, and must not name a host it never contacted.
  it("marks a refusal that sent nothing as undisclosed", async () => {
    const { close, store: database } = store();
    try {
      await recordDeviceDisclosure(database, TENANT, {
        filterRuleId: RULE,
        id: "d1",
        result: { decision: "undecided", refusal: "not-configured" },
        sourceItemId: ITEM,
      });
      const [row] = await deviceDisclosures(database, TENANT);
      expect(row?.disclosed).toBe(0);
      expect(row?.endpoint_host).toBeNull();
      expect(row?.failure_reason).toBe("not-configured");
      expect(row?.decision).toBe("undecided");
    } finally {
      close();
    }
  });

  // A request that left and came back useless still disclosed what it sent, so it is recorded as
  // disclosed with the reason it failed.
  it("records a failed answer as disclosed, with its reason", async () => {
    const { close, store: database } = store();
    try {
      await recordDeviceDisclosure(database, TENANT, {
        filterRuleId: RULE,
        id: "d1",
        result: { ...answered("match"), decision: "undecided", refusal: "invalid-response" },
        sourceItemId: ITEM,
      });
      const [row] = await deviceDisclosures(database, TENANT);
      expect(row?.disclosed).toBe(1);
      expect(row?.endpoint_host).toBe("192.168.1.10");
      expect(row?.failure_reason).toBe("invalid-response");
    } finally {
      close();
    }
  });

  it("is idempotent for one evaluation", async () => {
    const { close, store: database } = store();
    try {
      const record = {
        filterRuleId: RULE,
        id: "d1",
        result: answered("match"),
        sourceItemId: ITEM,
      };
      await recordDeviceDisclosure(database, TENANT, record);
      await recordDeviceDisclosure(database, TENANT, record);
      expect(await deviceDisclosures(database, TENANT)).toHaveLength(1);
    } finally {
      close();
    }
  });

  it("keeps one tenant's history out of another's", async () => {
    const { close, store: database } = store();
    try {
      await recordDeviceDisclosure(database, TENANT, {
        filterRuleId: RULE,
        id: "d1",
        result: answered("match"),
        sourceItemId: ITEM,
      });
      expect(
        await deviceDisclosures(database, "70000000-0000-4000-8000-0000000000f2"),
      ).toStrictEqual([]);
    } finally {
      close();
    }
  });

  // A rule can be deleted or a clause evaluated outside any rule, so the column is nullable and the
  // row still stands as a record that something was sent.
  it("records a disclosure with no rule attached", async () => {
    const { close, store: database } = store();
    try {
      await recordDeviceDisclosure(database, TENANT, {
        filterRuleId: undefined,
        id: "d1",
        result: answered("no-match"),
        sourceItemId: ITEM,
      });
      const [row] = await deviceDisclosures(database, TENANT);
      expect(row?.filter_rule_id).toBeNull();
      expect(row?.decision).toBe("no-match");
    } finally {
      close();
    }
  });
});
