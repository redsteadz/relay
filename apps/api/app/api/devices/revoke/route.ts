import { deviceMutationRequestSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../lib/auth";
import { DeviceUnavailableError, revokeDevice } from "../../../../lib/devices";
import { loggedErrorResponse } from "../../../../lib/observability";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;
  if (auth.accessToken === undefined) {
    return Response.json({ error: { code: "bearer_required" } }, { status: 401 });
  }
  const parsed = deviceMutationRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return Response.json({ error: { code: "invalid_device" } }, { status: 400 });
  try {
    await revokeDevice(auth.accessToken, parsed.data.id);
    return new Response(null, { status: 204 });
  } catch (error) {
    const unavailable = error instanceof DeviceUnavailableError;
    const response = Response.json(
      { error: { code: unavailable ? "device_unavailable" : "device_revocation_unavailable" } },
      { status: unavailable ? 404 : 503 },
    );
    return unavailable
      ? response
      : loggedErrorResponse(
          request,
          error,
          {
            code: "DEVICE_REVOCATION_FAILED",
            event: "device.revocation_failed",
            integration: "supabase",
            operation: "revokeDevice",
          },
          response,
        );
  }
}
