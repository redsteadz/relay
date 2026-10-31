import type { NotificationSilenceSnapshot } from "@relay/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SilenceAuthorization } from "@/lib/notification-silence";

const appState = vi.hoisted(() => ({
  handlers: [] as ((state: string) => void)[],
  remove: vi.fn(),
}));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, handler: (state: string) => void) => {
      appState.handlers.push(handler);
      return { remove: appState.remove };
    },
  },
}));

const configureNotificationSilence = vi.hoisted(() =>
  vi.fn<(tenantId: string, snapshot: NotificationSilenceSnapshot) => Promise<void>>(() =>
    Promise.resolve(),
  ),
);
vi.mock("@/modules/relay-device-ingress", () => ({
  default: { configureNotificationSilence },
}));

const server = vi.hoisted(() => ({
  listSilenceAuthorizations: vi.fn<() => Promise<SilenceAuthorization[]>>(),
  readDismissalSettings: vi.fn(() => Promise.resolve(false)),
}));
vi.mock("./silence", () => server);

const { publishSilenceOnForeground, publishSilenceSnapshot, withdrawThenSave } =
  await import("./silenceSnapshot");

const TENANT = "70000000-0000-4000-8000-000000000001";
const SERIES = "6f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f600";
const client = {} as SupabaseClient;

function authorized(overrides: Partial<SilenceAuthorization> = {}): SilenceAuthorization {
  return {
    action: "dismiss",
    authorized: true,
    dryRunCompletedAt: undefined,
    dryRunStartedAt: undefined,
    enabled: true,
    id: "7f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f607",
    name: "Shell pings",
    plan: {
      compilerVersion: 1,
      deterministic: {
        field: "source.applicationId",
        operator: "equals",
        value: "com.android.shell",
      },
      intent: "synthetic intent",
      schemaVersion: 1,
    },
    seriesId: SERIES,
    version: 1,
    ...overrides,
  };
}

/** The next revision a pause appends: same series, no authorization row. */
const paused = authorized({
  authorized: false,
  enabled: false,
  id: "7f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f608",
  version: 2,
});

function published(): NotificationSilenceSnapshot[] {
  return configureNotificationSilence.mock.calls.map(([, snapshot]) => snapshot);
}

beforeEach(() => {
  vi.clearAllMocks();
  appState.handlers.length = 0;
  server.listSilenceAuthorizations.mockResolvedValue([authorized()]);
});

describe("publishing the quiet rules", () => {
  it("leaves what the database authorized on the device", async () => {
    await publishSilenceSnapshot(client, TENANT);
    expect(published()).toHaveLength(1);
    expect(published()[0]?.mode).toBe("enforcing");
    expect(published()[0]?.rules.map((rule) => rule.filterRuleId)).toStrictEqual([authorized().id]);
  });

  it("does not let one failed publish stall the next", async () => {
    server.listSilenceAuthorizations.mockRejectedValueOnce(new Error("offline"));
    await expect(publishSilenceSnapshot(client, TENANT)).rejects.toThrow("offline");
    await publishSilenceSnapshot(client, TENANT);
    expect(published()).toHaveLength(1);
  });
});

describe("withdrawing a rule", () => {
  it("takes the rule off the device before the change is saved", async () => {
    const save = vi.fn(() => {
      // The database has not been asked yet, and the device has already let go.
      expect(published().at(-1)?.rules).toStrictEqual([]);
      expect(published().at(-1)?.mode).toBe("off");
      return Promise.resolve("saved");
    });
    await expect(withdrawThenSave(client, TENANT, SERIES, save)).resolves.toBe("saved");
    expect(save).toHaveBeenCalledOnce();
  });

  it("leaves the device with less than the database when the save fails", async () => {
    const save = () => Promise.reject(new Error("pipeline timed out"));
    await expect(withdrawThenSave(client, TENANT, SERIES, save)).rejects.toThrow(
      "pipeline timed out",
    );
    // The database still authorizes the rule; the device does not act on it.
    expect(published()).toHaveLength(1);
    expect(published()[0]?.rules).toStrictEqual([]);
  });

  it("keeps other rules on the device", async () => {
    const other = authorized({
      id: "7f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f609",
      seriesId: "6f1a2b3c-4d5e-4f60-8a91-b2c3d4e5f601",
    });
    server.listSilenceAuthorizations.mockResolvedValue([authorized(), other]);
    await withdrawThenSave(client, TENANT, SERIES, () => Promise.resolve());
    expect(published()[0]?.rules.map((rule) => rule.filterRuleId)).toStrictEqual([other.id]);
  });

  it("has nothing to withdraw for a rule that does not exist yet", async () => {
    await withdrawThenSave(client, TENANT, undefined, () => Promise.resolve());
    expect(configureNotificationSilence).not.toHaveBeenCalled();
  });

  // Without the queue, a publish that read the database before the save landed would write the
  // old authorization back over the withdrawal.
  it("holds back a publish that starts while the save is in flight", async () => {
    let saved = false;
    server.listSilenceAuthorizations.mockImplementation(() =>
      Promise.resolve(saved ? [authorized(), paused] : [authorized()]),
    );
    let finishSave: () => void = () => undefined;
    const withdrawal = withdrawThenSave(
      client,
      TENANT,
      SERIES,
      () =>
        new Promise<void>((resolve) => {
          finishSave = () => {
            saved = true;
            resolve();
          };
        }),
    );
    await vi.waitFor(() => expect(published()).toHaveLength(1));

    const refresh = publishSilenceSnapshot(client, TENANT);
    await Promise.resolve();
    expect(server.listSilenceAuthorizations).toHaveBeenCalledTimes(1);

    finishSave();
    await Promise.all([withdrawal, refresh]);
    expect(published()).toHaveLength(2);
    expect(published()[1]?.rules).toStrictEqual([]);
  });
});

describe("keeping the device current", () => {
  it("publishes at once and each time the app comes to the foreground", async () => {
    const stop = publishSilenceOnForeground(client, TENANT);
    await vi.waitFor(() => expect(published()).toHaveLength(1));

    appState.handlers.forEach((handler) => handler("background"));
    appState.handlers.forEach((handler) => handler("active"));
    await vi.waitFor(() => expect(published()).toHaveLength(2));

    stop();
    expect(appState.remove).toHaveBeenCalledOnce();
  });

  it("picks up a rule paused on another device", async () => {
    const stop = publishSilenceOnForeground(client, TENANT);
    await vi.waitFor(() => expect(published()).toHaveLength(1));
    expect(published()[0]?.mode).toBe("enforcing");

    server.listSilenceAuthorizations.mockResolvedValue([authorized(), paused]);
    appState.handlers.forEach((handler) => handler("active"));
    await vi.waitFor(() => expect(published()).toHaveLength(2));
    expect(published()[1]?.mode).toBe("off");
    stop();
  });
});
