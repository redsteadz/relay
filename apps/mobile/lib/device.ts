import {
  deviceRegistrationResponseSchema,
  type DeviceRegistrationResponse,
} from "@relay/contracts";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { AppError, categoryForHttpStatus } from "@relay/observability";
import { Platform } from "react-native";
import RelayDeviceIngress from "../modules/relay-device-ingress";
import { mobileRequestId } from "./observability";

const volatileWebIds = new Map<string, string>();

/**
 * SecureStore rejects any key outside `[A-Za-z0-9._-]`, and it validates on read as well as write,
 * so a separator it does not accept makes every device registration throw before the request is
 * built. Supabase user IDs are UUIDs, which are already within that set.
 */
export function deviceInstallationKey(userId: string): string {
  return `relay-device.${userId}`;
}

async function installationId(userId: string): Promise<string> {
  const key = deviceInstallationKey(userId);
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
  const operationRequestId = mobileRequestId();
  try {
    const response = await fetch(`${baseUrl}/api/devices/register`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-relay-request-id": operationRequestId,
      },
      body: JSON.stringify({ id, platform: Platform.OS }),
    });
    if (!response.ok) {
      throw new AppError("Device registration failed", {
        category: categoryForHttpStatus(response.status),
        code: "DEVICE_REGISTRATION_REJECTED",
        integration: "relay-api",
        operation: "registerInstallation",
        statusCode: response.status,
      });
    }
    return deviceRegistrationResponseSchema.parse(await response.json());
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    throw new AppError("Device registration failed", {
      category: "network",
      cause: error,
      code: "DEVICE_REGISTRATION_FAILED",
      integration: "relay-api",
      operation: "registerInstallation",
    });
  }
}

export async function revokeInstallation(
  userId: string,
  accessToken: string,
  deviceId: string,
): Promise<void> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const operationRequestId = mobileRequestId();
  try {
    const response = await fetch(`${baseUrl}/api/devices/revoke`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-relay-request-id": operationRequestId,
      },
      body: JSON.stringify({ id: deviceId }),
    });
    if (!response.ok) {
      throw new AppError("Device revocation failed", {
        category: categoryForHttpStatus(response.status),
        code: "DEVICE_REVOCATION_REJECTED",
        integration: "relay-api",
        operation: "revokeInstallation",
        statusCode: response.status,
      });
    }
    await RelayDeviceIngress.clearCaptureQueue(userId);
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    throw new AppError("Device revocation failed", {
      category: "network",
      cause: error,
      code: "DEVICE_REVOCATION_FAILED",
      integration: "relay-api",
      operation: "revokeInstallation",
    });
  }
}
