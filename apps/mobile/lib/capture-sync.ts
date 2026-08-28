import type { IngressEnvelope } from "@relay/contracts";

import RelayDeviceIngress from "../modules/relay-device-ingress";
import { drainCaptureQueue, type CaptureQueueStore } from "./capture-queue";

function nativeStore(): CaptureQueueStore {
  return {
    acknowledge: (tenantId, envelopeId) =>
      RelayDeviceIngress.acknowledgeCapture(tenantId, envelopeId),
    fail: (tenantId, envelopeId, terminal) =>
      RelayDeviceIngress.failCapture(tenantId, envelopeId, terminal),
    ready: (tenantId, now) => RelayDeviceIngress.getReadyCaptures(tenantId, now),
  };
}

export async function syncQueuedCaptures(tenantId: string, deviceId: string, accessToken: string) {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  return drainCaptureQueue(nativeStore(), tenantId, async (envelope: IngressEnvelope) => {
    const response = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ deviceId, envelope }),
    });
    return { status: response.status, body: await response.json().catch(() => undefined) };
  });
}
