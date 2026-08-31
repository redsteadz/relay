import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "../../../../lib/auth";
import {
  CredentialConflictError,
  CredentialEndpointInvalidError,
  CredentialNotFoundError,
  CredentialRejectedError,
  CredentialValidationUnavailableError,
  getOpenAiCredentialStatus,
  loadOpenAiEnv,
  revokeOpenAiCredential,
  rotateOpenAiCredential,
  submitOpenAiCredential,
} from "../../../../lib/openai-credentials";
import { DELETE, GET, PATCH, POST } from "./route";

vi.mock("../../../../lib/auth", () => ({ authenticateRequest: vi.fn() }));
vi.mock("../../../../lib/openai-credentials", () => ({
  CredentialConflictError: class extends Error {},
  CredentialEndpointInvalidError: class extends Error {},
  CredentialNotFoundError: class extends Error {},
  CredentialRejectedError: class extends Error {},
  CredentialValidationUnavailableError: class extends Error {},
  getOpenAiCredentialStatus: vi.fn(),
  loadOpenAiEnv: vi.fn(),
  revokeOpenAiCredential: vi.fn(),
  rotateOpenAiCredential: vi.fn(),
  submitOpenAiCredential: vi.fn(),
}));

const env = {
  kekKeyring: "synthetic",
  supabaseUrl: "https://relay-auth.example.test",
  supabaseServiceRoleKey: "synthetic-service-key",
  relayEnvironment: "development",
};

function request(url: string, init?: RequestInit) {
  return new Request(url, init);
}

describe("/api/connectors/openai", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadOpenAiEnv).mockReturnValue(env);
    vi.mocked(authenticateRequest).mockResolvedValue({
      accessToken: "synthetic-token",
      userId: "638ce145-a77d-4c32-b798-cb398e881fc9",
    });
  });

  it("GET returns configuration metadata without credential material", async () => {
    vi.mocked(getOpenAiCredentialStatus).mockResolvedValue({
      provider: "openai",
      configured: true,
      lastValidatedAt: "2026-08-27T00:00:00Z",
    });
    const response = await GET(request("https://relay.test/api/connectors/openai"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      provider: "openai",
      configured: true,
      lastValidatedAt: "2026-08-27T00:00:00Z",
    });
  });

  it("returns 503 when the connector is not configured on this deployment", async () => {
    vi.mocked(loadOpenAiEnv).mockReturnValue(null);
    const response = await GET(request("https://relay.test/api/connectors/openai"));
    expect(response.status).toBe(503);
  });

  it("POST rejects a malformed body without calling the credential store", async () => {
    const response = await POST(
      request("https://relay.test/api/connectors/openai", {
        method: "POST",
        body: JSON.stringify({ apiKey: "" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(submitOpenAiCredential).not.toHaveBeenCalled();
  });

  it("POST submits a valid key using bearer authority only", async () => {
    vi.mocked(submitOpenAiCredential).mockResolvedValue({
      provider: "openai",
      configured: true,
      lastValidatedAt: "2026-08-27T00:00:00Z",
    });
    const response = await POST(
      request("https://relay.test/api/connectors/openai", {
        method: "POST",
        body: JSON.stringify({ apiKey: "sk-synthetic-0123456789" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(submitOpenAiCredential).toHaveBeenCalledWith(
      "638ce145-a77d-4c32-b798-cb398e881fc9",
      "sk-synthetic-0123456789",
      env,
      undefined,
    );
  });

  it("POST forwards a submitted endpoint so the key is stored for the right provider", async () => {
    vi.mocked(submitOpenAiCredential).mockResolvedValue({
      provider: "openai",
      configured: true,
      endpoint: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
      validated: true,
    });

    const response = await POST(
      new Request("https://relay.test/api/connectors/openai", {
        method: "POST",
        body: JSON.stringify({
          apiKey: "sk-deepseek-synthetic",
          endpoint: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(submitOpenAiCredential).toHaveBeenCalledWith(
      "638ce145-a77d-4c32-b798-cb398e881fc9",
      "sk-deepseek-synthetic",
      env,
      { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    );
  });

  it("POST rejects an unknown field in the endpoint rather than storing it", async () => {
    const response = await POST(
      new Request("https://relay.test/api/connectors/openai", {
        method: "POST",
        body: JSON.stringify({
          apiKey: "sk-synthetic-0123456789",
          endpoint: { baseUrl: "https://api.deepseek.com/v1", apiKey: "leaked" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(submitOpenAiCredential).not.toHaveBeenCalled();
  });

  it("POST maps a refused endpoint to a deterministic 400", async () => {
    vi.mocked(submitOpenAiCredential).mockRejectedValue(new CredentialEndpointInvalidError());

    const response = await POST(
      new Request("https://relay.test/api/connectors/openai", {
        method: "POST",
        body: JSON.stringify({
          apiKey: "sk-synthetic-0123456789",
          endpoint: { baseUrl: "https://169.254.169.254/v1" },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "openai_endpoint_invalid" } });
  });

  it("POST maps a provider rejection to 400 without leaking the reason body", async () => {
    vi.mocked(submitOpenAiCredential).mockRejectedValue(new CredentialRejectedError());
    const response = await POST(
      request("https://relay.test/api/connectors/openai", {
        method: "POST",
        body: JSON.stringify({ apiKey: "sk-synthetic-0123456789" }),
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { code: "openai_key_rejected" } });
  });

  it("POST maps a duplicate connection to 409", async () => {
    vi.mocked(submitOpenAiCredential).mockRejectedValue(new CredentialConflictError());
    const response = await POST(
      request("https://relay.test/api/connectors/openai", {
        method: "POST",
        body: JSON.stringify({ apiKey: "sk-synthetic-0123456789" }),
      }),
    );
    expect(response.status).toBe(409);
  });

  it("POST maps an unreachable provider to 502", async () => {
    vi.mocked(submitOpenAiCredential).mockRejectedValue(new CredentialValidationUnavailableError());
    const response = await POST(
      request("https://relay.test/api/connectors/openai", {
        method: "POST",
        body: JSON.stringify({ apiKey: "sk-synthetic-0123456789" }),
      }),
    );
    expect(response.status).toBe(502);
  });

  it("PATCH rotates an existing key", async () => {
    vi.mocked(rotateOpenAiCredential).mockResolvedValue({
      provider: "openai",
      configured: true,
      lastValidatedAt: "2026-08-27T00:00:00Z",
    });
    const response = await PATCH(
      request("https://relay.test/api/connectors/openai", {
        method: "PATCH",
        body: JSON.stringify({ apiKey: "sk-rotated-0123456789" }),
      }),
    );
    expect(response.status).toBe(200);
  });

  it("PATCH returns 404 when nothing is configured to rotate", async () => {
    vi.mocked(rotateOpenAiCredential).mockRejectedValue(new CredentialNotFoundError());
    const response = await PATCH(
      request("https://relay.test/api/connectors/openai", {
        method: "PATCH",
        body: JSON.stringify({ apiKey: "sk-rotated-0123456789" }),
      }),
    );
    expect(response.status).toBe(404);
  });

  it("DELETE revokes the configured key", async () => {
    vi.mocked(revokeOpenAiCredential).mockResolvedValue({ revoked: true });
    const response = await DELETE(request("https://relay.test/api/connectors/openai"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ provider: "openai", configured: false });
  });

  it("DELETE returns 404 when there is nothing to revoke", async () => {
    vi.mocked(revokeOpenAiCredential).mockResolvedValue({ revoked: false });
    const response = await DELETE(request("https://relay.test/api/connectors/openai"));
    expect(response.status).toBe(404);
  });

  it("propagates authentication failure on every method", async () => {
    const unauthorized = Response.json({ error: { code: "unauthorized" } }, { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({ error: unauthorized });

    const getResponse = await GET(request("https://relay.test/api/connectors/openai"));
    const deleteResponse = await DELETE(request("https://relay.test/api/connectors/openai"));
    expect(getResponse.status).toBe(401);
    expect(deleteResponse.status).toBe(401);
    expect(getOpenAiCredentialStatus).not.toHaveBeenCalled();
    expect(revokeOpenAiCredential).not.toHaveBeenCalled();
  });
});
