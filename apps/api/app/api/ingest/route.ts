import { deviceIngressRequestSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../lib/auth";
import { authorizeDeviceIngress } from "../../../lib/devices";
import { publishIngress } from "../../../lib/pipeline";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) {
    return auth.error;
  }

  const parsed = deviceIngressRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return Response.json(
      { error: { code: "invalid_ingress", message: "Payload does not match ingress contract" } },
      { status: 400 },
    );
  }

  if (auth.accessToken !== undefined) {
    try {
      if (!(await authorizeDeviceIngress(auth.accessToken, parsed.data.deviceId))) {
        return Response.json(
          { error: { code: "device_unavailable", message: "Device is not active" } },
          { status: 403 },
        );
      }
    } catch {
      return Response.json(
        { error: { code: "device_check_unavailable", message: "Could not authorize device" } },
        { status: 503 },
      );
    }
  }

  const pipelineResponse = await publishIngress({
    userId: auth.userId,
    envelope: parsed.data.envelope,
  });
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

  // Queue publication is the durability boundary for device acknowledgement. The explicit flag
  // prevents clients from treating an unrelated or intermediary 202 as permission to delete.
  return Response.json(
    { accepted: true, durable: true, id: parsed.data.envelope.id },
    { status: 202 },
  );
}
