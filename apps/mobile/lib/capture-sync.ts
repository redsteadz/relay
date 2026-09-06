import type { IngressEnvelope } from "@relay/contracts";
import { AppError, normalizeError } from "@relay/observability";

import RelayDeviceIngress from "../modules/relay-device-ingress";
import { drainCaptureQueue, type CaptureQueueStore } from "./capture-queue";
import { mobileRequestId } from "./observability";
import { relayApiBaseUrl } from "./relay-api";

function nativeStore(): CaptureQueueStore {
  return {
    acknowledge: (tenantId, envelopeId) =>
      RelayDeviceIngress.acknowledgeCapture(tenantId, envelopeId),
    fail: (tenantId, envelopeId, terminal) =>
      RelayDeviceIngress.failCapture(tenantId, envelopeId, terminal),
    ready: (tenantId, now) => RelayDeviceIngress.getReadyCaptures(tenantId, now),
  };
}

/**
 * Uploads whatever the device is holding.
 *
 * The origin is resolved once, before anything is read, so a build without `EXPO_PUBLIC_API_URL`
 * reports a configuration fault rather than quietly addressing `localhost` -- which on a phone is
 * the phone, and which therefore failed as an ordinary network error on a path nothing surfaced.
 *
 * The device is registered on the first capture actually being sent rather than ahead of the drain.
 * Registration used to be a precondition for reading the queue at all, so a device that could not be
 * registered never reached the queue and left every row at zero attempts, indistinguishable from a
 * queue nothing had tried. It is also pointless work when there is nothing to upload.
 */
export async function syncQueuedCaptures(
  tenantId: string,
  resolveDeviceId: () => Promise<string>,
  accessToken: string,
) {
  const baseUrl = relayApiBaseUrl();
  let deviceId: string | undefined;
  return drainCaptureQueue(nativeStore(), tenantId, async (envelope: IngressEnvelope) => {
    deviceId ??= await resolveDeviceId();
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
