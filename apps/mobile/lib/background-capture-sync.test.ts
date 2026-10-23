import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: true,
  platform: { OS: "android" },
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  prepare: vi.fn(),
  capabilities: vi.fn(),
  register: vi.fn(),
  upload: vi.fn(),
  derive: vi.fn(),
  retry: vi.fn(),
  silence: vi.fn(),
  defineTask: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: mocks.platform }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: () => Promise.resolve(mocks.enabled ? "enabled" : "disabled"),
    setItem: vi.fn(),
  },
}));
vi.mock("expo-task-manager", () => ({ defineTask: mocks.defineTask }));
vi.mock("expo-background-task", () => ({ BackgroundTaskResult: { Success: 1, Failed: 2 } }));
vi.mock("./auth-configuration", () => ({
  createConfiguredClient: () => ({
    auth: {
      getSession: mocks.getSession,
      refreshSession: mocks.refreshSession,
    },
  }),
}));
vi.mock("./demo/mode", () => ({ demoModeEnabled: () => false }));
vi.mock("../modules/relay-device-ingress", () => ({
  default: {
    prepareNotificationCaptureState: mocks.prepare,
    getCapabilities: mocks.capabilities,
    scheduleCaptureRetry: mocks.retry,
  },
}));
vi.mock("./device", () => ({ registerInstallation: mocks.register }));
vi.mock("./capture-sync", () => ({ syncQueuedCaptures: mocks.upload }));
vi.mock("./device-derivation", () => ({ deriveQueuedCaptures: mocks.derive }));
vi.mock("@/features/silence/api/silenceResolution", () => ({
  resolvePendingSilencesForTenant: mocks.silence,
}));
import { runBackgroundCaptureSync } from "./background-capture-sync";

const session = { user: { id: "synthetic-background-account" }, access_token: "synthetic-token" };

describe("headless capture delivery integration (mock native and network)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.platform.OS = "android";
    mocks.getSession.mockResolvedValue({ data: { session }, error: null });
    mocks.prepare.mockResolvedValue(undefined);
    mocks.capabilities.mockResolvedValue({
      notificationListener: true,
      notificationCapturePaused: false,
    });
    mocks.register.mockResolvedValue({ id: "synthetic-installation" });
    mocks.upload.mockResolvedValue({ acknowledged: 1, failed: 0, pending: 0 });
    mocks.retry.mockResolvedValue(undefined);
  });
  it("prepares a restored tenant before reading captures with no mounted React tree", async () => {
    expect(await runBackgroundCaptureSync()).toBe("delivered");
    expect(mocks.prepare).toHaveBeenCalledWith(
      session.user.id,
      undefined,
      expect.any(Number),
      false,
    );
    expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.capabilities.mock.invocationCallOrder[0],
    );
    expect(mocks.upload).toHaveBeenCalledWith(
      session.user.id,
      "synthetic-installation",
      "synthetic-token",
    );
    expect(mocks.retry).toHaveBeenCalledWith(session.user.id);
  });
  it("does not deliver or resolve quiet candidates without background consent", async () => {
    mocks.enabled = false;
    expect(await runBackgroundCaptureSync()).toBe("disabled");
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.silence).not.toHaveBeenCalled();
  });
  it("does not read another account's queue while logged out", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await runBackgroundCaptureSync()).toBe("no-session");
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("refreshes an expired session before upload", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { ...session, expires_at: 1 } },
      error: null,
    });
    mocks.refreshSession.mockResolvedValue({
      data: { session: { ...session, access_token: "synthetic-refreshed" } },
      error: null,
    });
    await runBackgroundCaptureSync();
    expect(mocks.upload).toHaveBeenCalledWith(
      session.user.id,
      "synthetic-installation",
      "synthetic-refreshed",
    );
  });
  it("reports pending delivery as a failure and schedules durable recovery", async () => {
    mocks.upload.mockResolvedValue({ acknowledged: 0, failed: 0, pending: 1 });
    await expect(runBackgroundCaptureSync()).rejects.toThrow("Capture delivery remains pending");
    expect(mocks.retry).toHaveBeenCalledWith(session.user.id);
    expect(mocks.silence).not.toHaveBeenCalled();
    mocks.upload.mockResolvedValue({ acknowledged: 1, failed: 0, pending: 0 });
    expect(await runBackgroundCaptureSync()).toBe("delivered");
  });
});
