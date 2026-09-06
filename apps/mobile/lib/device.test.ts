import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
const installationId = "19784902-e7a4-4f7f-b04d-e3a78c876629";

vi.mock("expo-crypto", () => ({ randomUUID: vi.fn(() => installationId) }));
// SecureStore validates keys on every call and rejects anything outside this set. The mock must
// enforce the same rule, or an unusable key passes here and throws on every real device.
const ensureValidKey = vi.hoisted(() => (key: string) => {
  if (!/^[\w.-]+$/u.test(key)) {
    throw new Error(
      `Invalid key provided to SecureStore. Keys must not be empty and contain only alphanumeric characters, ".", "-", and "_".`,
    );
  }
});
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn((key: string) => {
    ensureValidKey(key);
    return Promise.resolve(storage.get(key) ?? null);
  }),
  setItemAsync: vi.fn((key: string, value: string) => {
    ensureValidKey(key);
    storage.set(key, value);
    return Promise.resolve();
  }),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
const clearCaptureQueue = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("../modules/relay-device-ingress", () => ({
  default: { clearCaptureQueue },
}));

import { deviceInstallationKey, registerInstallation, revokeInstallation } from "./device";

describe("deviceInstallationKey", () => {
  it("stays within the character set SecureStore accepts", () => {
    const key = deviceInstallationKey("208455fe-e5ae-4dc3-b416-40c7186ac6b2");
    expect(key).toMatch(/^[\w.-]+$/u);
    expect(() => ensureValidKey(key)).not.toThrow();
  });
});

describe("registerInstallation", () => {
  beforeEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.relay.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

    expect(storage.get(deviceInstallationKey("638ce145-a77d-4c32-b798-cb398e881fc9"))).toBe(
      installationId,
    );
    const [, init] = fetchMock.mock.lastCall ?? [];
    expect(fetchMock.mock.lastCall?.[0]).toBe("https://api.relay.test/api/devices/register");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer synthetic-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({ id: installationId, platform: "android" }),
    });
    expect(new Headers(init?.headers).get("x-relay-request-id")).toMatch(/^[0-9a-f-]+$/i);
  });

  // Registering used to address `http://localhost:3000` when this was unset. On a phone that is the
  // phone, so a build with no origin configured reported a network failure from the device itself
  // rather than the configuration fault it was.
  it("reports a missing origin as configuration rather than reaching for localhost", async () => {
    vi.stubEnv("EXPO_PUBLIC_API_URL", "");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      registerInstallation("638ce145-a77d-4c32-b798-cb398e881fc9", "synthetic-token"),
    ).rejects.toMatchObject({ category: "configuration" });
    expect(fetchMock).not.toHaveBeenCalled();
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
