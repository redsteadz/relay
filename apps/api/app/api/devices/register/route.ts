import { deviceRegistrationRequestSchema } from "@relay/contracts";

import { authenticateRequest } from "../../../../lib/auth";
import { DeviceUnavailableError, registerDevice } from "../../../../lib/devices";

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;
  if (auth.accessToken === undefined) {
    return Response.json({ error: { code: "bearer_required" } }, { status: 401 });
  }
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return Response.json({ error: { code: "invalid_device" } }, { status: 400 });
  }
  const parsed = deviceRegistrationRequestSchema.safeParse(value);
  if (!parsed.success) return Response.json({ error: { code: "invalid_device" } }, { status: 400 });
  try {
    const device = await registerDevice(auth.accessToken, parsed.data.id, parsed.data.platform);
    return Response.json(device, { status: 200 });
  } catch (error) {
    const unavailable = error instanceof DeviceUnavailableError;
    return Response.json(
      { error: { code: unavailable ? "device_unavailable" : "device_registration_unavailable" } },
      { status: unavailable ? 403 : 503 },
    );
  }
}
