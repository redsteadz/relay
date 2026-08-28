import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../../lib/auth";
import {
  ConnectionNotFoundError,
  listTaskLists,
  loadGoogleTasksEnv,
} from "../../../../../lib/google-tasks";
import { GET } from "./route";

vi.mock("../../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../../lib/google-tasks", () => ({
  ConnectionNotFoundError: class extends Error {},
  listTaskLists: vi.fn(),
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

describe("GET /api/connectors/google-tasks/task-lists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadGoogleTasksEnv).mockReturnValue(env);
    vi.mocked(authenticateRequest).mockResolvedValue({
      accessToken: "synthetic-token",
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    });
  });

  it("returns the caller's task lists using bearer authority only", async () => {
    vi.mocked(listTaskLists).mockResolvedValue([{ id: "list-1", title: "Inbox" }]);
    const response = await GET(
      new Request("https://relay.test/api/connectors/google-tasks/task-lists"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      taskLists: [{ id: "list-1", title: "Inbox" }],
    });
    expect(listTaskLists).toHaveBeenCalledWith("638ce145-a77d-4c32-b798-cb398e881fc9", env);
  });

  it("returns 404 when nothing is connected yet", async () => {
    vi.mocked(listTaskLists).mockRejectedValue(new ConnectionNotFoundError());
    const response = await GET(
      new Request("https://relay.test/api/connectors/google-tasks/task-lists"),
    );
    expect(response.status).toBe(404);
  });

  it("returns 502 when Google is unreachable rather than a raw 500", async () => {
    vi.mocked(listTaskLists).mockRejectedValue(new Error("network down"));
    const response = await GET(
      new Request("https://relay.test/api/connectors/google-tasks/task-lists"),
    );
    expect(response.status).toBe(502);
  });
});
