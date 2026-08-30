import { parseKekKeyring, type KekKeyring } from "@relay/crypto";

import { parseRelayEnvironment, type RelayEnvironment } from "./encryption";
import type { Env } from "./env";

export type SupabaseConfiguration = {
  serviceRoleKey: string;
  url: string;
};

export type PersistenceConfiguration = {
  environment: RelayEnvironment;
  keyring: KekKeyring;
  supabase?: SupabaseConfiguration;
};

export class PersistenceConfigurationError extends Error {
  constructor(
    readonly reason: "encryption-keyring-invalid" | "persistence-configuration-invalid",
    cause?: unknown,
  ) {
    super(
      "Pipeline persistence configuration is invalid",
      cause === undefined ? undefined : { cause },
    );
  }
}

export function supabaseBackendHeaders(serviceRoleKey: string): HeadersInit {
  return {
    apikey: serviceRoleKey,
    "content-type": "application/json",
  };
}

function parseSupabaseUrl(value: string, environment: RelayEnvironment): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error: unknown) {
    throw new PersistenceConfigurationError("persistence-configuration-invalid", error);
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.protocol !== "https:" && !(environment === "development" && loopback))
  ) {
    throw new PersistenceConfigurationError("persistence-configuration-invalid");
  }
  return url.toString().replace(/\/$/u, "");
}

export function readPersistenceConfiguration(env: Env): PersistenceConfiguration {
  let environment: RelayEnvironment;
  try {
    environment = parseRelayEnvironment(env.RELAY_ENVIRONMENT);
  } catch (error: unknown) {
    throw new PersistenceConfigurationError("persistence-configuration-invalid", error);
  }

  let keyring: KekKeyring;
  try {
    keyring = parseKekKeyring(env.RELAY_CREDENTIAL_KEK_KEYRING);
  } catch (error: unknown) {
    throw new PersistenceConfigurationError("encryption-keyring-invalid", error);
  }

  const allowLocalDurability = env.RELAY_ALLOW_LOCAL_DURABILITY === "true";
  if (environment === "production" && allowLocalDurability) {
    throw new PersistenceConfigurationError("persistence-configuration-invalid");
  }

  const rawUrl = env.SUPABASE_URL;
  const rawServiceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (rawUrl === undefined && rawServiceRoleKey === undefined) {
    if (environment === "development" && allowLocalDurability) return { environment, keyring };
    throw new PersistenceConfigurationError("persistence-configuration-invalid");
  }
  if (
    rawUrl === undefined ||
    rawServiceRoleKey === undefined ||
    rawUrl.trim() !== rawUrl ||
    rawServiceRoleKey.trim() !== rawServiceRoleKey ||
    rawUrl.length === 0 ||
    !/^sb_secret_[A-Za-z0-9_-]{16,}$/u.test(rawServiceRoleKey)
  ) {
    throw new PersistenceConfigurationError("persistence-configuration-invalid");
  }

  return {
    environment,
    keyring,
    supabase: {
      serviceRoleKey: rawServiceRoleKey,
      url: parseSupabaseUrl(rawUrl, environment),
    },
  };
}
