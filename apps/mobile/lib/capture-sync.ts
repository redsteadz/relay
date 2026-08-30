import type { IngressEnvelope } from "@relay/contracts";
import { AppError, normalizeError } from "@relay/observability";

import RelayDeviceIngress from "../modules/relay-device-ingress";
import { drainCaptureQueue, type CaptureQueueStore } from "./capture-queue";
import { mobileRequestId } from "./observability";

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
    const operationRequestId = mobileRequestId();
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/ingest`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "x-relay-request-id": operationRequestId,
        },
        body: JSON.stringify({ deviceId, envelope }),
      });
    } catch (error: unknown) {
      throw normalizeError(error, {
        code: "CAPTURE_UPLOAD_REQUEST_FAILED",
        integration: "relay-api",
        metadata: { durationMs: Date.now() - startedAt, requestId: operationRequestId },
        operation: "POST /api/ingest",
      });
    }
    if (response.status !== 202) return { status: response.status, body: undefined };
    try {
      return { status: response.status, body: (await response.json()) as unknown };
    } catch (error: unknown) {
      throw new AppError("Capture acknowledgement was malformed", {
        category: "malformed-response",
        cause: error,
        code: "CAPTURE_UPLOAD_MALFORMED_RESPONSE",
        integration: "relay-api",
        metadata: { durationMs: Date.now() - startedAt, requestId: operationRequestId },
        operation: "POST /api/ingest",
        statusCode: response.status,
      });
    }
  });
}
