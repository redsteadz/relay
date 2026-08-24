import type { IngressEnvelope } from "@relay/contracts";

export const demoIngress: IngressEnvelope = {
  schemaVersion: 1,
  id: "cf4c3c89-0a15-4edb-94df-77786bcdddb4",
  occurredAt: "2026-08-24T12:41:00Z",
  capturedAt: "2026-08-24T12:41:01Z",
  source: {
    kind: "notification",
    externalId: "demo-card-purchase",
    applicationId: "com.example.bank",
  },
  sender: "Example Bank",
  subject: "Card purchase approved",
  body: "USD 14.20 at NORTH STATION",
  attributes: {
    amount: "14.20",
    currency: "USD",
    merchant: "North Station",
  },
};

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
