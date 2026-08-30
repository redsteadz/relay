import { describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  createRelaySupabaseClient: vi.fn(),
  logMobileError: vi.fn(),
}));

vi.mock("./observability", () => ({ logMobileError: dependencies.logMobileError }));
vi.mock("./supabase", () => ({
  createRelaySupabaseClient: dependencies.createRelaySupabaseClient,
}));

import { createConfiguredClient } from "./auth-configuration";

describe("auth client configuration", () => {
  it("reports repeated configuration failures once without caching clients", () => {
    const configurationError = new Error("synthetic missing configuration");
    dependencies.createRelaySupabaseClient.mockImplementation(() => {
      throw configurationError;
    });

    const clients = Array.from({ length: 25 }, () => createConfiguredClient());

    expect(clients).toEqual(Array.from({ length: 25 }, () => undefined));
    expect(dependencies.createRelaySupabaseClient).toHaveBeenCalledTimes(25);
    expect(dependencies.logMobileError).toHaveBeenCalledOnce();
    expect(dependencies.logMobileError).toHaveBeenCalledWith(
      "auth.configuration_failed",
      configurationError,
      {
        code: "AUTH_CONFIGURATION_FAILED",
        integration: "supabase-auth",
        operation: "createRelaySupabaseClient",
      },
    );

    const configuredClient = { auth: {} };
    dependencies.createRelaySupabaseClient.mockReturnValue(configuredClient);

    expect(createConfiguredClient()).toBe(configuredClient);
    expect(dependencies.createRelaySupabaseClient).toHaveBeenCalledTimes(26);
    expect(dependencies.logMobileError).toHaveBeenCalledOnce();
  });
});
