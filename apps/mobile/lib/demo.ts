import { ingressEnvelopeSchema } from "@relay/contracts";
import { AppError, categoryForHttpStatus } from "@relay/observability";

import demoIngressFixture from "../../../fixtures/demo-ingress.json";
import { mobileRequestId } from "./observability";

export const demoIngress = ingressEnvelopeSchema.parse(demoIngressFixture);

export async function sendDemoIngress(
  accessToken: string,
  deviceId: string,
): Promise<{ accepted: boolean; id: string }> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const operationRequestId = mobileRequestId();
  try {
    const response = await fetch(`${baseUrl}/api/ingest`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        "x-relay-request-id": operationRequestId,
      },
      body: JSON.stringify({ deviceId, envelope: demoIngress }),
    });

    if (!response.ok) {
      throw new AppError("Demo ingestion failed", {
        category: categoryForHttpStatus(response.status),
        code: "DEMO_INGRESS_REJECTED",
        integration: "relay-api",
        operation: "sendDemoIngress",
        statusCode: response.status,
      });
    }

    return (await response.json()) as { accepted: boolean; id: string };
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    throw new AppError("Demo ingestion failed", {
      category: "network",
      cause: error,
      code: "DEMO_INGRESS_FAILED",
      integration: "relay-api",
      operation: "sendDemoIngress",
    });
  }
}
