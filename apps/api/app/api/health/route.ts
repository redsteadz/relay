import { healthResponseSchema } from "@relay/contracts";

export function GET() {
  return Response.json(
    healthResponseSchema.parse({ service: "relay-api", status: "ok", version: "0.1.0" }),
  );
}
