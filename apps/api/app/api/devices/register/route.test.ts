import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../lib/auth";
import { registerDevice } from "../../../../lib/devices";
import { POST } from "./route";

vi.mock("../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../lib/devices", () => ({
  DeviceUnavailableError: class extends Error {},
  registerDevice: vi.fn(),
}));

const id = "19784902-e7a4-4f7f-b04d-e3a78c876629";

describe("POST /api/devices/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      accessToken: "synthetic-token",
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    });
  });

  it("registers only bounded device metadata using bearer authority", async () => {
    vi.mocked(registerDevice).mockResolvedValue({
      id,
      name: "Android 197849",
      platform: "android",
    });
    const response = await POST(
      new Request("https://relay.test/api/devices/register", {
        method: "POST",
        body: JSON.stringify({ id, platform: "android" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(registerDevice).toHaveBeenCalledWith("synthetic-token", id, "android");
    await expect(response.json()).resolves.toEqual({
      id,
      name: "Android 197849",
      platform: "android",
    });
  });

  it("rejects client-supplied ownership", async () => {
    const response = await POST(
      new Request("https://relay.test/api/devices/register", {
        method: "POST",
        body: JSON.stringify({ id, platform: "android", userId: id }),
      }),
    );
    expect(response.status).toBe(400);
    expect(registerDevice).not.toHaveBeenCalled();
  });
});
