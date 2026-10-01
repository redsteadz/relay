import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/observability", () => ({
  logMobileError: vi.fn(),
  mobileRequestId: () => "demo-request",
  reportUnexpectedUiError: vi.fn(),
  runInBackground: (operation: Promise<unknown>) => {
    void operation.catch(() => undefined);
  },
}));

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: (key: string) => Promise.resolve(storage.get(key) ?? null),
    setItem: (key: string, value: string) => {
      storage.set(key, value);
      return Promise.resolve();
    },
  },
}));

vi.mock("@/modules/relay-device-ingress", () => ({
  default: { getRetainedCaptureContent: () => Promise.resolve({}) },
}));

import { loadProposedActions } from "@/features/actions/api/actions";
import { loadActivityLedger } from "@/features/activity/api/activity";
import { loadAuditTrail } from "@/features/activity/api/auditLog";
import { listFilterRevisions } from "@/features/filters/api/filters";
import { listInbox } from "@/features/inbox/api/inbox";
import { inboxSections } from "@/features/inbox/models/inboxPresentation";
import { listCategories } from "@/lib/categories";

import { DEMO_USER_ID } from "./account";
import { createDemoSupabaseClient } from "./client";

/**
 * The demo store read through the app's own queries.
 *
 * These are the shipped readers, unchanged: if the local stand-in drifts from the column names,
 * ordering or `->>` accessors they use, an empty screen is the symptom and this is what catches it.
 */
describe("demo Supabase client", () => {
  it("serves an inbox that reaches every group", async () => {
    const client = createDemoSupabaseClient();
    const items = await listInbox(client, DEMO_USER_ID);
    expect(items.length).toBeGreaterThan(5);

    const sections = inboxSections(items);
    for (const group of ["actionable", "filed", "needs-review", "unfiled"] as const) {
      const section = sections.find((candidate) => candidate.group === group);
      expect(section?.items.length, `${group} has no items`).toBeGreaterThan(0);
    }
  });

  it("names the category a rule filed a capture into", async () => {
    const client = createDemoSupabaseClient();
    const items = await listInbox(client, DEMO_USER_ID);
    const filed = items.filter((item) => item.category !== undefined);
    expect(filed.length).toBeGreaterThan(0);
    for (const item of filed) {
      expect(item.category?.origin).toBe("device");
      expect(item.category?.name).toEqual(expect.any(String));
    }
  });

  it("serves categories, rules, proposals and the activity ledger", async () => {
    const client = createDemoSupabaseClient();
    const [categories, revisions, proposals, ledger, audit] = await Promise.all([
      listCategories(client),
      listFilterRevisions(client),
      loadProposedActions(client),
      loadActivityLedger(client),
      loadAuditTrail(client),
    ]);

    expect(categories.some((category) => category.isSystem)).toBe(true);
    expect(categories.some((category) => !category.isSystem)).toBe(true);
    // A rule with two revisions is what makes the history on the rules screen real.
    expect(new Set(revisions.map((revision) => revision.seriesId)).size).toBeLessThan(
      revisions.length,
    );
    expect(proposals.runs.length).toBeGreaterThan(0);
    expect(proposals.rules.length).toBeGreaterThan(0);
    expect(ledger.runs.some((run) => run.status === "succeeded")).toBe(true);
    expect(ledger.runs.some((run) => run.status === "failed")).toBe(true);
    expect(audit.length).toBeGreaterThan(0);
  });

  it("records a decision through the routine rather than by writing the row", async () => {
    const client = createDemoSupabaseClient();
    const before = await loadProposedActions(client);
    const target = before.runs[0];
    expect(target).toBeDefined();

    const { error } = await client.rpc("decide_action_run", {
      p_action_run_id: target.id,
      p_decision: "approve",
    });
    expect(error).toBeNull();

    const after = await loadProposedActions(client);
    expect(after.runs.some((run) => run.id === target.id)).toBe(false);

    // Refusing a second decision is the transition table doing its job, not a stale copy of status.
    const repeat = await client.rpc("decide_action_run", {
      p_action_run_id: target.id,
      p_decision: "approve",
    });
    expect(repeat.error).not.toBeNull();
  });

  it("hides and restores an inbox item", async () => {
    const client = createDemoSupabaseClient();
    const items = await listInbox(client, DEMO_USER_ID);
    const target = items[0];
    const { hideInboxEvent, listHiddenInbox, restoreInboxEvent } =
      await import("@/features/inbox/api/inbox");

    await hideInboxEvent(client, DEMO_USER_ID, target.id);
    expect((await listInbox(client, DEMO_USER_ID)).some((item) => item.id === target.id)).toBe(
      false,
    );
    expect(
      (await listHiddenInbox(client, DEMO_USER_ID)).some((item) => item.id === target.id),
    ).toBe(true);

    await restoreInboxEvent(client, DEMO_USER_ID, target.id);
    expect((await listInbox(client, DEMO_USER_ID)).some((item) => item.id === target.id)).toBe(
      true,
    );
  });
});

describe("demo category writes", () => {
  it("creates, renames and archives a category", async () => {
    const client = createDemoSupabaseClient();
    const { createCategory, deleteCategory, listCategories, updateCategory } =
      await import("@/lib/categories");

    const created = await createCategory(client, DEMO_USER_ID, {
      name: "Utilities",
      slug: "utilities",
    });
    expect(created.isSystem).toBe(false);
    expect(created.archivedAt).toBeUndefined();

    const renamed = await updateCategory(client, created.id, { name: "Bills" });
    expect(renamed.name).toBe("Bills");

    const archived = await updateCategory(client, created.id, { archived: true });
    expect(archived.archivedAt).toEqual(expect.any(String));
    expect((await listCategories(client)).some((row) => row.id === created.id)).toBe(false);
    expect(
      (await listCategories(client, { includeArchived: true })).some(
        (row) => row.id === created.id,
      ),
    ).toBe(true);

    // Nothing was ever filed here, so this one really can be removed.
    await expect(deleteCategory(client, created.id)).resolves.toBeUndefined();
  });

  it("refuses a duplicate name and a system category deletion", async () => {
    const client = createDemoSupabaseClient();
    const { createCategory, deleteCategory, listCategories } = await import("@/lib/categories");

    await expect(
      createCategory(client, DEMO_USER_ID, { name: "Transactions", slug: "transactions-copy" }),
    ).rejects.toMatchObject({ reason: "duplicate-name" });

    const system = (await listCategories(client)).find((row) => row.isSystem);
    expect(system).toBeDefined();
    await expect(
      deleteCategory(client, (system as NonNullable<typeof system>).id),
    ).rejects.toMatchObject({ reason: "protected-system-category" });
  });
});
