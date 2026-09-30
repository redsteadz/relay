import { describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/observability", () => ({
  logMobileError: vi.fn(),
  runInBackground: (operation: Promise<unknown>) => {
    void operation.catch(() => undefined);
  },
}));

import {
  accountDeletionResponseSchema,
  filterCompileResponseSchema,
  openAiCredentialStatusSchema,
  privacyDisclosuresResponseSchema,
  privacyOverviewResponseSchema,
  privacyPurgeResponseSchema,
} from "@relay/contracts";

import { demoRelayApi } from "./relay-api";

/**
 * Every response is parsed by the contract the app parses it with.
 *
 * A demo that returned a convenient shape would let the caller's own validation pass unexercised,
 * and the first thing to break in a real build would be the thing the demo never checked.
 */
describe("demo Relay API", () => {
  it("answers the privacy overview and purges raw payloads", async () => {
    const overview = await demoRelayApi("/api/privacy", { method: "GET" });
    expect(overview.status).toBe(200);
    const parsed = privacyOverviewResponseSchema.parse(overview.body);
    expect(parsed.retention.retainedCount).toBeGreaterThan(0);

    const purge = await demoRelayApi("/api/privacy/raw-payloads", { method: "DELETE" });
    expect(privacyPurgeResponseSchema.parse(purge.body).purgedCount).toBe(
      parsed.retention.retainedCount,
    );

    const after = await demoRelayApi("/api/privacy", { method: "GET" });
    expect(privacyOverviewResponseSchema.parse(after.body).retention.retainedCount).toBe(0);
  });

  it("lists disclosures", async () => {
    const response = await demoRelayApi("/api/privacy/disclosures?limit=100", { method: "GET" });
    const parsed = privacyDisclosuresResponseSchema.parse(response.body);
    expect(parsed.disclosures.length).toBeGreaterThan(0);
    expect(parsed.disclosures[0].purpose).toBe("filter-semantic-clause");
  });

  it("stores and revokes a key without ever returning one", async () => {
    const stored = await demoRelayApi("/api/connectors/openai", {
      body: { apiKey: "sk-demo-placeholder" },
      method: "POST",
    });
    const status = openAiCredentialStatusSchema.parse(stored.body);
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("sk-demo-placeholder");

    const revoked = await demoRelayApi("/api/connectors/openai", { method: "DELETE" });
    expect(openAiCredentialStatusSchema.parse(revoked.body).configured).toBe(false);
  });

  it("compiles a rule and appends a revision to its series", async () => {
    const created = await demoRelayApi("/api/filters/compile", {
      body: { intent: "app is com.whatsapp", name: "Demo rule" },
      method: "POST",
    });
    const first = filterCompileResponseSchema.parse(created.body);
    expect(first.rule.version).toBe(1);
    expect(first.rule.plan.deterministic).toEqual({
      field: "source.applicationId",
      operator: "equals",
      value: "com.whatsapp",
    });

    const edited = await demoRelayApi("/api/filters/compile", {
      body: {
        expectedVersion: 1,
        intent: "app is com.whatsapp and subject contains invoice",
        name: "Demo rule",
        seriesId: first.rule.seriesId,
      },
      method: "POST",
    });
    expect(filterCompileResponseSchema.parse(edited.body).rule.version).toBe(2);

    // A stale expectation is refused rather than overwriting whatever is current.
    const stale = await demoRelayApi("/api/filters/compile", {
      body: {
        expectedVersion: 1,
        intent: "app is com.whatsapp",
        name: "Demo rule",
        seriesId: first.rule.seriesId,
      },
      method: "POST",
    });
    expect(stale.status).toBe(409);
  });

  it("removes what the account held when it is deleted", async () => {
    const before = await demoRelayApi("/api/privacy", { method: "GET" });
    expect(privacyOverviewResponseSchema.parse(before.body).deletion).toBeNull();

    // Capture settings are account data too: an allowlist that outlived its account would still
    // name the apps the deleted person chose to share.
    const { demoCapabilities, demoConfigureNotificationCapture } = await import("./device-ingress");
    await demoConfigureNotificationCapture(["com.whatsapp"], true);

    const deleted = await demoRelayApi("/api/privacy/account", {
      body: { confirm: "delete my account" },
      method: "DELETE",
    });
    expect(accountDeletionResponseSchema.parse(deleted.body).deletion.state).toBe("completed");

    const { demoDatabase } = await import("./store");
    expect(demoDatabase.rows("relay_events")).toHaveLength(0);
    expect(demoDatabase.rows("categories")).toHaveLength(0);
    expect(demoDatabase.rows("filter_rules")).toHaveLength(0);
    expect(demoDatabase.rows("capture_settings")).toHaveLength(0);

    const after = await demoRelayApi("/api/privacy", { method: "GET" });
    expect(privacyOverviewResponseSchema.parse(after.body).deletion?.state).toBe("completed");

    // Reset brings back the seeded account, and with it the default capture settings.
    await demoDatabase.reset();
    const capabilities = await demoCapabilities();
    expect(capabilities.notificationCapturePaused).toBe(false);
    expect(capabilities.notificationAllowedPackages).not.toContain("com.whatsapp");
    expect(capabilities.notificationAllowedPackages.length).toBeGreaterThan(0);
  });

  it("refuses a route it does not implement", async () => {
    const response = await demoRelayApi("/api/unknown", { method: "GET" });
    expect(response.status).toBe(404);
  });
});
