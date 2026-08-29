import {
  canonicalUuidSchema,
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

export type SourcePersistenceV3Result =
  "duplicate" | "fact-integrity-conflict" | "stored" | "tenant-conflict";

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
  const queueEnvelopeId = canonicalUuidSchema.safeParse(message.envelopeId);
  return parsed.success &&
    queueEnvelopeId.success &&
    parsed.data.envelope.id === queueEnvelopeId.data &&
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

export async function parseSourcePersistenceV3Response(
  response: Response,
): Promise<SourcePersistenceV3Result> {
  if (!response.ok) {
    throw new SourcePersistenceError(
      response.status === 409 ? "tenant_id_conflict" : "persistence_unavailable",
    );
  }
  const stored = await response.json<unknown>().catch(() => undefined);
  if (
    stored === "stored" ||
    stored === "duplicate" ||
    stored === "fact-integrity-conflict" ||
    stored === "tenant-conflict"
  ) {
    return stored;
  }
  throw new SourcePersistenceError("persistence_response_invalid");
}
