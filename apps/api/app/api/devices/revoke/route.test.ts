import { expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../lib/auth";
import { revokeDevice } from "../../../../lib/devices";
import { POST } from "./route";

vi.mock("../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../lib/devices", () => ({
  DeviceUnavailableError: class extends Error {},
  revokeDevice: vi.fn(),
}));

it("revokes installation using bearer authority", async () => {
  const id = "19784902-e7a4-4f7f-b04d-e3a78c876629";
  vi.mocked(authenticateRequest).mockResolvedValue({
    accessToken: "synthetic-token",
    userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
  });
  vi.mocked(revokeDevice).mockResolvedValue();
  const response = await POST(
    new Request("https://relay.test/api/devices/revoke", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  );
  expect(response.status).toBe(204);
  expect(revokeDevice).toHaveBeenCalledWith("synthetic-token", id);
});
