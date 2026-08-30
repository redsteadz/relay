import { createClient } from "@supabase/supabase-js";

import { deviceRegistrationResponseSchema } from "@relay/contracts";
import type { Database } from "../../../supabase/database.generated";
import { databaseError } from "./observability";

export class DeviceUnavailableError extends Error {}

function client(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url === undefined || key === undefined) throw new Error("Device repository is unavailable");
  return createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { authorization: `Bearer ${accessToken}` } },
  });
}

export async function registerDevice(accessToken: string, id: string, platform: string) {
  const { data, error } = await client(accessToken).rpc("register_device", {
    p_device_id: id,
    p_platform: platform,
  });
  if (error?.code === "P0002") throw new DeviceUnavailableError("Device is unavailable");
  if (error !== null) throw databaseError(error, "DEVICE_REGISTRATION_FAILED", "registerDevice");
  const row = data as { id?: unknown; name?: unknown; platform?: unknown } | null;
  const parsed = deviceRegistrationResponseSchema.safeParse({
    id: row?.id,
    name: row?.name,
    platform: row?.platform,
  });
  if (!parsed.success) {
    throw databaseError(parsed.error, "DEVICE_REGISTRATION_RESPONSE_INVALID", "registerDevice");
  }
  return parsed.data;
}

export async function revokeDevice(accessToken: string, id: string): Promise<void> {
  const { error } = await client(accessToken).rpc("revoke_device", { p_device_id: id });
  if (error?.code === "P0002") throw new DeviceUnavailableError("Device is unavailable");
  if (error !== null) throw databaseError(error, "DEVICE_REVOCATION_FAILED", "revokeDevice");
}

export async function authorizeDeviceIngress(accessToken: string, id: string): Promise<boolean> {
  const { data, error } = await client(accessToken).rpc("authorize_device_ingress", {
    p_device_id: id,
  });
  if (error !== null) {
    throw databaseError(error, "DEVICE_AUTHORIZATION_FAILED", "authorizeDeviceIngress");
  }
  if (typeof data !== "boolean") {
    throw databaseError(
      new Error("Device authorization response was invalid"),
      "DEVICE_AUTHORIZATION_RESPONSE_INVALID",
      "authorizeDeviceIngress",
    );
  }
  return data;
}
