import { authenticateRequest } from "../../../../lib/auth";
import { listDisclosures, loadPrivacyEnv } from "../../../../lib/privacy";

export async function GET(request: Request) {
  const env = loadPrivacyEnv();
  if (env === null) {
    return Response.json(
      { error: { code: "privacy_not_configured", message: "Privacy controls are not configured" } },
      { status: 503 },
    );
  }

  const auth = await authenticateRequest(request);
  if ("error" in auth) return auth.error;

  const rawLimit = new URL(request.url).searchParams.get("limit") ?? "100";
  if (!/^\d{1,3}$/u.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100) {
    return Response.json(
      { error: { code: "invalid_request", message: "limit must be between 1 and 100" } },
      { status: 400 },
    );
  }

  try {
    return Response.json({
      disclosures: await listDisclosures(auth.userId, env, Number(rawLimit)),
    });
  } catch {
    return Response.json(
      { error: { code: "disclosures_unavailable", message: "Disclosure history unavailable" } },
      { status: 503 },
    );
  }
}
