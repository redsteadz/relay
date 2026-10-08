import { deviceSemanticConfigSchema, type DeviceSemanticConfig } from "@relay/contracts";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * The model endpoint this device uses, and its key if it needs one.
 *
 * Keystore-backed and never uploaded. This is not the server's BYOK credential: the API stores that
 * encrypted and never returns it, which is correct and unchanged, and neither side learns the
 * other's. A reader may configure both — the device for local evaluation, the server for the hosted
 * path. See [ADR-0019](../../../docs/decisions/0019-device-semantic-evaluation.md).
 *
 * Scoped per tenant, so signing into a different account does not inherit the previous reader's
 * endpoint, and clearing one account's configuration leaves the other's alone. The local store is
 * forbidden from holding an `api_key` column and a test asserts it; this is where a key belongs
 * instead.
 */
const volatileWebConfigs = new Map<string, string>();

/**
 * SecureStore rejects any key outside `[A-Za-z0-9._-]` and validates on read as well as write, so a
 * separator it does not accept would make every read throw. Supabase user IDs are UUIDs, which are
 * already within that set — the same reasoning as `deviceInstallationKey`.
 */
export function deviceSemanticConfigKey(tenantId: string): string {
  return `relay-semantic.${tenantId}`;
}

async function readRaw(key: string): Promise<string | null> {
  if (Platform.OS === "web") return volatileWebConfigs.get(key) ?? null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    // An unreadable keychain entry is indistinguishable from an absent one as far as behaviour
    // goes: either way this device has no endpoint, and semantic clauses stay awaiting a model.
    return null;
  }
}

/**
 * The configuration, or nothing.
 *
 * Parsed through the contract on the way out rather than trusted, because a stored value can predate
 * a change to the shape. An unparseable one is treated as absent, which leaves clauses awaiting a
 * model rather than sending a request built from a guess.
 */
export async function readDeviceSemanticConfig(
  tenantId: string,
): Promise<DeviceSemanticConfig | undefined> {
  const stored = await readRaw(deviceSemanticConfigKey(tenantId));
  if (stored === null) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return undefined;
  }
  const parsed = deviceSemanticConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Validates before storing, so an endpoint that could never be used is refused at the point of entry. */
export async function writeDeviceSemanticConfig(
  tenantId: string,
  config: unknown,
): Promise<DeviceSemanticConfig> {
  const parsed = deviceSemanticConfigSchema.parse(config);
  const key = deviceSemanticConfigKey(tenantId);
  const serialized = JSON.stringify(parsed);
  if (Platform.OS === "web") volatileWebConfigs.set(key, serialized);
  else await SecureStore.setItemAsync(key, serialized);
  return parsed;
}

/**
 * Forgets this device's endpoint and key.
 *
 * Separate from revoking the server's credential, and the privacy screen says so: one does not
 * revoke the other, because neither is derivable from the other.
 */
export async function clearDeviceSemanticConfig(tenantId: string): Promise<void> {
  const key = deviceSemanticConfigKey(tenantId);
  if (Platform.OS === "web") {
    volatileWebConfigs.delete(key);
    return;
  }
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // Already gone is the outcome this was asked for.
  }
}
