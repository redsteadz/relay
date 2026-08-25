import { ingressEnvelopeSchema } from "@relay/contracts";

import demoIngressFixture from "../../../fixtures/demo-ingress.json";

export const demoIngress = ingressEnvelopeSchema.parse(demoIngressFixture);

export async function sendDemoIngress(): Promise<{ accepted: boolean; id: string }> {
  const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";
  const response = await fetch(`${baseUrl}/api/ingest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-relay-development-user": "00000000-0000-4000-8000-000000000001",
    },
    body: JSON.stringify(demoIngress),
  });

  if (!response.ok) {
    throw new Error(`Ingestion failed with ${response.status.toString()}`);
  }

  return (await response.json()) as { accepted: boolean; id: string };
}
