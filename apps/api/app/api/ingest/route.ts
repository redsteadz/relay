import { ingressEnvelopeSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../lib/auth";
import { publishIngress } from "../../../lib/pipeline";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) {
    return auth.error;
  }

  const parsed = ingressEnvelopeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_ingress", message: "Payload does not match ingress contract" } },
      { status: 400 },
    );
  }

  const pipelineResponse = await publishIngress({ userId: auth.userId, envelope: parsed.data });
  if (pipelineResponse.status === 413) {
    return Response.json(
      { error: { code: "ingress_too_large", message: "Payload exceeds ingestion size limit" } },
      { status: 413 },
    );
  }
  if (!pipelineResponse.ok) {
    return Response.json(
      { error: { code: "pipeline_unavailable", message: "Could not queue source item" } },
      { status: 503 },
    );
  }

  return Response.json({ accepted: true, id: parsed.data.id }, { status: 202 });
}
