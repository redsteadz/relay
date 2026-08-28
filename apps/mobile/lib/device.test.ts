import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
const installationId = "19784902-e7a4-4f7f-b04d-e3a78c876629";

vi.mock("expo-crypto", () => ({ randomUUID: vi.fn(() => installationId) }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn((key: string) => Promise.resolve(storage.get(key) ?? null)),
  setItemAsync: vi.fn((key: string, value: string) => {
    storage.set(key, value);
    return Promise.resolve();
  }),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
const clearCaptureQueue = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../modules/relay-device-ingress", () => ({
  default: { clearCaptureQueue },
}));

import { registerInstallation, revokeInstallation } from "./device";

describe("registerInstallation", () => {
  beforeEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
  });

  it("persists one native installation ID per user and registers without source content", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(
          Response.json({ id: installationId, name: "Android 197849", platform: "android" }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await registerInstallation("638ce145-a77d-4c32-b798-cb398e881fc9", "synthetic-token");
    await registerInstallation("638ce145-a77d-4c32-b798-cb398e881fc9", "synthetic-token");

    expect(storage.get("relay-device:638ce145-a77d-4c32-b798-cb398e881fc9")).toBe(installationId);
    expect(fetchMock).toHaveBeenLastCalledWith("http://localhost:3000/api/devices/register", {
      method: "POST",
      headers: { authorization: "Bearer synthetic-token", "content-type": "application/json" },
      body: JSON.stringify({ id: installationId, platform: "android" }),
    });
  });

  it("clears encrypted tenant data after device revocation", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await revokeInstallation(
      "638ce145-a77d-4c32-b798-cb398e881fc9",
      "synthetic-token",
      installationId,
    );

    expect(clearCaptureQueue).toHaveBeenCalledWith("638ce145-a77d-4c32-b798-cb398e881fc9");
  });
});
