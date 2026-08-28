import {
  encryptedIngressPayloadSchema,
  type IngressEnvelope,
  type IngressQueueMessage,
} from "@relay/contracts";

export class SourcePersistenceError extends Error {
  constructor(
    readonly reason:
      "persistence_response_invalid" | "persistence_unavailable" | "tenant_id_conflict",
  ) {
    super("Source persistence failed");
  }
}

export function parseDecryptedIngressEnvelope(
  plaintext: string,
  message: Pick<IngressQueueMessage, "acceptedAt" | "envelopeId" | "rawExpiresAt">,
): IngressEnvelope | undefined {
  let value: unknown;
  try {
    value = JSON.parse(plaintext) as unknown;
  } catch {
    return undefined;
  }
  const parsed = encryptedIngressPayloadSchema.safeParse(value);
  return parsed.success &&
    parsed.data.envelope.id === message.envelopeId &&
    Date.parse(parsed.data.acceptedAt) === Date.parse(message.acceptedAt) &&
    Date.parse(parsed.data.rawExpiresAt) === Date.parse(message.rawExpiresAt)
    ? parsed.data.envelope
    : undefined;
}

export async function parseSourcePersistenceResponse(
  response: Response,
): Promise<"duplicate" | "stored"> {
  if (!response.ok) {
    throw new SourcePersistenceError(
      response.status === 409 ? "tenant_id_conflict" : "persistence_unavailable",
    );
  }
  const stored = await response.json<unknown>().catch(() => undefined);
  if (stored === true) return "stored";
  if (stored === false) return "duplicate";
  throw new SourcePersistenceError("persistence_response_invalid");
}
