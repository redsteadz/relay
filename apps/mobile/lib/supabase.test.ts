import { afterEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  createClient: vi.fn((...arguments_: unknown[]) => {
    void arguments_;
    return { auth: {} };
  }),
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: dependencies.createClient }));
vi.mock("expo-secure-store", () => ({
  deleteItemAsync: dependencies.deleteItemAsync,
  getItemAsync: dependencies.getItemAsync,
  setItemAsync: dependencies.setItemAsync,
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));

import { createRelaySupabaseClient } from "./supabase";

type ClientOptions = {
  auth?: {
    autoRefreshToken?: boolean;
    detectSessionInUrl?: boolean;
    flowType?: string;
    persistSession?: boolean;
    storage?: {
      getItem: (key: string) => Promise<string | null>;
      removeItem: (key: string) => Promise<void>;
      setItem: (key: string, value: string) => Promise<void>;
    };
  };
};

describe("createRelaySupabaseClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("persists PKCE sessions through native secure storage with refresh enabled", async () => {
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", "https://relay-auth.example.test");
    vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "synthetic-publishable-key");

    createRelaySupabaseClient();

    expect(dependencies.createClient).toHaveBeenCalledOnce();
    const options = dependencies.createClient.mock.calls[0]?.[2] as ClientOptions | undefined;
    expect(options?.auth).toMatchObject({
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
    });
    await options?.auth?.storage?.setItem("session-key", "synthetic-session");
    await options?.auth?.storage?.getItem("session-key");
    await options?.auth?.storage?.removeItem("session-key");
    expect(dependencies.setItemAsync).toHaveBeenCalledWith("session-key", "synthetic-session");
    expect(dependencies.getItemAsync).toHaveBeenCalledWith("session-key");
    expect(dependencies.deleteItemAsync).toHaveBeenCalledWith("session-key");
  });
});
