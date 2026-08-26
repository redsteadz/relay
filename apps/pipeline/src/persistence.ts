import { ingressEnvelopeSchema, type IngressEnvelope } from "@relay/contracts";

export function parseDecryptedIngressEnvelope(
  plaintext: string,
  envelopeId: string,
): IngressEnvelope | undefined {
  let value: unknown;
  try {
    value = JSON.parse(plaintext) as unknown;
  } catch {
    return undefined;
  }
  const parsed = ingressEnvelopeSchema.safeParse(value);
  return parsed.success && parsed.data.id === envelopeId ? parsed.data : undefined;
}

export async function parseSourcePersistenceResponse(
  response: Response,
): Promise<"duplicate" | "stored"> {
  if (!response.ok) throw new Error(`Source persistence failed with ${response.status.toString()}`);
  const stored = await response.json<unknown>().catch(() => undefined);
  if (stored === true) return "stored";
  if (stored === false) return "duplicate";
  throw new Error("Source persistence response is invalid");
}
