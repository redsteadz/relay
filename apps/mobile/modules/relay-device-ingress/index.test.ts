import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  prepareNotificationCaptureState: vi.fn(),
  getUnsynchronizedCaptureIds: vi.fn(),
  finishCaptureLogout: vi.fn(),
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: {} } }));
vi.mock("react-native", () => ({ Platform: { OS: "android" }, PermissionsAndroid: {} }));
vi.mock("../../lib/demo/mode", () => ({ demoModeEnabled: () => false }));
vi.mock("../../lib/demo/device-ingress", () => ({ demoDeviceIngress: {} }));
vi.mock("./src/RelayDeviceIngressModule", () => ({ default: native }));

describe("native capture session bridge", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });
  it("requires preparation even for an unmounted cold-start runtime", async () => {
    const ingress = (await import("./index")).default;
    await expect(ingress.getUnsynchronizedCaptureIds("account-a")).rejects.toThrow("not prepared");
    expect(native.getUnsynchronizedCaptureIds).not.toHaveBeenCalled();
  });
  it("adopts the accepted native generation and forbids headless account cleanup", async () => {
    const ingress = (await import("./index")).default;
    native.prepareNotificationCaptureState.mockResolvedValue(200);
    native.getUnsynchronizedCaptureIds.mockResolvedValue(["synthetic-capture"]);
    await ingress.prepareNotificationCaptureState("account-a", undefined, 100, false);
    expect(native.prepareNotificationCaptureState).toHaveBeenCalledWith(
      "account-a",
      null,
      100,
      false,
    );
    expect(await ingress.getUnsynchronizedCaptureIds("account-a")).toEqual(["synthetic-capture"]);
    expect(native.getUnsynchronizedCaptureIds).toHaveBeenCalledWith("account-a", 200);
  });
  it("retains preparation when logout is cancelled but invalidates it after actual clearing", async () => {
    const ingress = (await import("./index")).default;
    native.prepareNotificationCaptureState.mockResolvedValue(100);
    await ingress.prepareNotificationCaptureState("account-a", undefined, 100);
    native.finishCaptureLogout.mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    expect(await ingress.finishCaptureLogout("account-a", false)).toBe(2);
    await ingress.getUnsynchronizedCaptureIds("account-a");
    expect(await ingress.finishCaptureLogout("account-a", true)).toBe(0);
    await expect(ingress.getUnsynchronizedCaptureIds("account-a")).rejects.toThrow("not prepared");
    expect(native.finishCaptureLogout).toHaveBeenLastCalledWith("account-a", true, 100);
  });
});
