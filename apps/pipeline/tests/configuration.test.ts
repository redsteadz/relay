import { describe, expect, it } from "vitest";

import { generateKek } from "@relay/crypto";

import {
  PersistenceConfigurationError,
  readPersistenceConfiguration,
  supabaseBackendHeaders,
} from "../src/configuration";
import type { Env } from "../src/env";

function environment(overrides: Record<string, unknown> = {}): Env {
  return {
    RELAY_CREDENTIAL_KEK_KEYRING: JSON.stringify({
      activeVersion: 1,
      keys: { 1: generateKek() },
    }),
    RELAY_ENVIRONMENT: "production",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic_backend_key_12345",
    SUPABASE_URL: "https://supabase.example.test",
    ...overrides,
  } as unknown as Env;
}

function expectInvalid(env: Env, reason: PersistenceConfigurationError["reason"]): void {
  try {
    readPersistenceConfiguration(env);
    throw new Error("Synthetic configuration unexpectedly passed");
  } catch (error) {
    expect(error).toBeInstanceOf(PersistenceConfigurationError);
    expect((error as PersistenceConfigurationError).reason).toBe(reason);
  }
}

describe("readPersistenceConfiguration", () => {
  it("accepts complete hosted production configuration", () => {
    expect(readPersistenceConfiguration(environment())).toMatchObject({
      environment: "production",
      supabase: { url: "https://supabase.example.test" },
    });
  });

  it.each([
    { SUPABASE_URL: undefined },
    { SUPABASE_SERVICE_ROLE_KEY: undefined },
    { SUPABASE_URL: "" },
    { SUPABASE_SERVICE_ROLE_KEY: " " },
    { SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_synthetic_public_key" },
    { SUPABASE_URL: "http://supabase.example.test" },
    { RELAY_ALLOW_LOCAL_DURABILITY: "true" },
  ])("fails closed for invalid production values %#", (overrides) => {
    expectInvalid(environment(overrides), "persistence-configuration-invalid");
  });

  it("distinguishes an invalid KEK without reflecting it", () => {
    expectInvalid(
      environment({ RELAY_CREDENTIAL_KEK_KEYRING: "synthetic-sensitive-invalid-keyring" }),
      "encryption-keyring-invalid",
    );
  });

  it("permits explicit local durability only in development", () => {
    const env = environment({
      RELAY_ALLOW_LOCAL_DURABILITY: "true",
      RELAY_ENVIRONMENT: "development",
      SUPABASE_SERVICE_ROLE_KEY: undefined,
      SUPABASE_URL: undefined,
    });
    expect(readPersistenceConfiguration(env).supabase).toBeUndefined();
  });

  it("permits loopback HTTP Supabase only in development", () => {
    const env = environment({
      RELAY_ENVIRONMENT: "development",
      SUPABASE_URL: "http://127.0.0.1:55321",
    });
    expect(readPersistenceConfiguration(env).supabase?.url).toBe("http://127.0.0.1:55321");
  });

  it("sends modern backend keys only through the API-key header", () => {
    expect(supabaseBackendHeaders("sb_secret_synthetic_backend_key_12345")).toEqual({
      apikey: "sb_secret_synthetic_backend_key_12345",
      "content-type": "application/json",
    });
  });
});
