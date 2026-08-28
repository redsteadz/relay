import {
  deviceRegistrationResponseSchema,
  type DeviceRegistrationResponse,
} from "@relay/contracts";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import RelayDeviceIngress from "../modules/relay-device-ingress";

const volatileWebIds = new Map<string, string>();

async function installationId(userId: string): Promise<string> {
  const key = `relay-device:${userId}`;
  const stored =
    Platform.OS === "web" ? (volatileWebIds.get(key) ?? null) : await SecureStore.getItemAsync(key);
  if (stored !== null) return stored;
  const created = Crypto.randomUUID();
  if (Platform.OS === "web") volatileWebIds.set(key, created);
  else await SecureStore.setItemAsync(key, created);
  return created;
}

export async function registerInstallation(
  userId: string,
  accessToken: string,
): Promise<DeviceRegistrationResponse> {
  const id = await installationId(userId);
  const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/devices/register`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ id, platform: Platform.OS }),
  });
  if (!response.ok)
    throw new Error(`Device registration failed with ${response.status.toString()}`);
  return deviceRegistrationResponseSchema.parse(await response.json());
}

export async function revokeInstallation(
  userId: string,
  accessToken: string,
  deviceId: string,
): Promise<void> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/devices/revoke`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ id: deviceId }),
  });
  if (!response.ok) throw new Error(`Device revocation failed with ${response.status.toString()}`);
  await RelayDeviceIngress.clearCaptureQueue(userId);
}
