import type { FilterCompileRequest, NotificationSilenceSnapshot } from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as SilenceApi from "@/features/silence/api/silence";
import type { SilenceAuthorization } from "@/lib/notification-silence";

vi.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: "android" },
}));

const configureNotificationSilence = vi.hoisted(() =>
  vi.fn<(tenantId: string, snapshot: NotificationSilenceSnapshot) => Promise<void>>(() =>
    Promise.resolve(),
  ),
);
vi.mock("@/modules/relay-device-ingress", () => ({
  default: { configureNotificationSilence },
  SILENCE_OUTCOME_LIMIT: 200,
}));

const listSilenceAuthorizations = vi.hoisted(() => vi.fn<() => Promise<SilenceAuthorization[]>>());
vi.mock("@/features/silence/api/silence", async (importOriginal) => ({
  ...(await importOriginal<typeof SilenceApi>()),
  listSilenceAuthorizations,
  readDismissalSettings: () => Promise.resolve(false),
}));

const authorizeNamedApplications = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/features/device-capture/hooks/authorizeNamedApplications", () => ({
  authorizeNamedApplications,
}));

const saveFilterRule = vi.hoisted(() => vi.fn());
vi.mock("../api/filters", () => ({ listFilterRevisions: vi.fn(), saveFilterRule }));

const { saveRuleRevision } = await import("./useFilterRules");
const { publishSilenceSnapshot } = await import("@/features/silence/api/silenceSnapshot");

const TENANT = "70000000-0000-4000-8000-000000000001";
const SERIES = "6f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f600";
const client = {} as SupabaseClient;

const plan = {
  compilerVersion: 1,
  deterministic: { field: "source.applicationId", operator: "equals", value: "com.android.shell" },
  intent: "subject contains relay-qa",
  schemaVersion: 1,
};

/** A rule set to clear, authorized directly from Quiet. */
const clearing: SilenceAuthorization = {
  action: "dismiss",
  authorized: true,
  dryRunCompletedAt: undefined,
  dryRunStartedAt: undefined,
  enabled: true,
  id: "7f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f607",
  name: "QA pings",
  plan,
  seriesId: SERIES,
  version: 1,
};

function request(overrides: Partial<FilterCompileRequest>): FilterCompileRequest {
  return {
    categoryId: null,
    enabled: true,
    intent: plan.intent,
    name: clearing.name,
    ...overrides,
  };
}

function published(): NotificationSilenceSnapshot[] {
  return configureNotificationSilence.mock.calls.map(([, snapshot]) => snapshot);
}

beforeEach(() => {
  vi.clearAllMocks();
  listSilenceAuthorizations.mockResolvedValue([clearing]);
  saveFilterRule.mockResolvedValue({ rule: { plan } });
});

// #251: the phone kept acting on a rule paused here until someone opened Quiet, which was the only
// thing that ever updated the device. Nothing below mounts Quiet or its hook.
describe("saving a rule from Rules", () => {
  // Otherwise every "no rules on the device" below would pass for the wrong reason.
  it("starts from a rule the device would act on", async () => {
    await publishSilenceSnapshot(client, TENANT);
    expect(published()[0]?.mode).toBe("enforcing");
    expect(published()[0]?.rules[0]?.action).toBe("dismiss");
  });

  it("takes a paused rule off the device before the save is sent", async () => {
    await saveRuleRevision(
      client,
      TENANT,
      "token",
      request({ enabled: false, expectedVersion: 1, seriesId: SERIES }),
    );

    expect(published()).toHaveLength(1);
    expect(published()[0]?.rules).toStrictEqual([]);
    expect(published()[0]?.mode).toBe("off");
    expect(configureNotificationSilence.mock.invocationCallOrder[0]).toBeLessThan(
      saveFilterRule.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("leaves the device with less than the server when an edit fails to save", async () => {
    saveFilterRule.mockRejectedValue(new Error("pipeline timed out"));
    await expect(
      saveRuleRevision(
        client,
        TENANT,
        "token",
        request({ expectedVersion: 1, intent: "subject contains qa", seriesId: SERIES }),
      ),
    ).rejects.toThrow("pipeline timed out");

    // The server still authorizes v1; the phone no longer acts on it.
    expect(published()).toHaveLength(1);
    expect(published()[0]?.rules).toStrictEqual([]);
    expect(authorizeNamedApplications).not.toHaveBeenCalled();
  });

  it("does not touch the device's quiet rules for a new rule", async () => {
    await saveRuleRevision(client, TENANT, "token", request({}));
    expect(configureNotificationSilence).not.toHaveBeenCalled();
    expect(saveFilterRule).toHaveBeenCalledOnce();
    expect(authorizeNamedApplications).toHaveBeenCalledWith(TENANT, ["com.android.shell"]);
  });
});
