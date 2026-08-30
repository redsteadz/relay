import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../../lib/auth";
import { disconnectGoogleTasks, loadGoogleTasksEnv } from "../../../../../lib/google-tasks";
import { POST } from "./route";

vi.mock("../../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../../lib/google-tasks", () => ({
  disconnectGoogleTasks: vi.fn(),
  loadGoogleTasksEnv: vi.fn(),
}));

const env = {
  googleClientId: "synthetic-client-id",
  googleClientSecret: "synthetic-client-secret",
  kekKeyring: "synthetic",
  supabaseUrl: "https://relay-auth.example.test",
  supabaseServiceRoleKey: "synthetic-service-key",
  relayEnvironment: "development",
};
const connectionId = "19784902-e7a4-4f7f-b04d-e3a78c876629";

describe("POST /api/connectors/google-tasks/disconnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadGoogleTasksEnv).mockReturnValue(env);
    vi.mocked(authenticateRequest).mockResolvedValue({
      accessToken: "synthetic-token",
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    });
  });

  it("disconnects using only the bearer-authenticated user and body connection id", async () => {
    vi.mocked(disconnectGoogleTasks).mockResolvedValue({ deleted: true, revoked: true });
    const response = await POST(
      new Request("https://relay.test/api/connectors/google-tasks/disconnect", {
        method: "POST",
        body: JSON.stringify({ connectionId }),
      }),
    );
    expect(response.status).toBe(200);
    expect(disconnectGoogleTasks).toHaveBeenCalledWith(
      "638ce145-a77d-4c32-b798-cb398e881fc9",
      connectionId,
      env,
      expect.any(String),
    );
    await expect(response.json()).resolves.toEqual({
      disconnected: true,
      connectionId,
      tokenRevoked: true,
    });
  });

  it("returns 404 rather than a false success when nothing was deleted", async () => {
    vi.mocked(disconnectGoogleTasks).mockResolvedValue({ deleted: false, revoked: false });
    const response = await POST(
      new Request("https://relay.test/api/connectors/google-tasks/disconnect", {
        method: "POST",
        body: JSON.stringify({ connectionId }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("rejects a missing connectionId without calling the library", async () => {
    const response = await POST(
      new Request("https://relay.test/api/connectors/google-tasks/disconnect", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(400);
    expect(disconnectGoogleTasks).not.toHaveBeenCalled();
  });
});
