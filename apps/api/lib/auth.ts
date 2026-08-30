import { createClient } from "@supabase/supabase-js";

import { relayUserIdSchema } from "@relay/contracts";
import { logApiError } from "./observability";

type AuthResult = { userId: string; accessToken?: string } | { error: Response };

function unauthorized(code: "invalid_token" | "unauthorized", message: string): AuthResult {
  return { error: Response.json({ error: { code, message } }, { status: 401 }) };
}

export async function authenticateRequest(request: Request): Promise<AuthResult> {
  const developmentUser = request.headers.get("x-relay-development-user");
  if (process.env.NODE_ENV !== "production" && developmentUser !== null) {
    const parsed = relayUserIdSchema.safeParse(developmentUser);
    if (parsed.success) return { userId: parsed.data };
    return {
      error: Response.json(
        { error: { code: "invalid_development_user", message: "Development user must be a UUID" } },
        { status: 401 },
      ),
    };
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (token === undefined || url === undefined || anonKey === undefined) {
    return unauthorized("unauthorized", "Authentication required");
  }

  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let result: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    result = await supabase.auth.getUser(token);
  } catch (error: unknown) {
    logApiError(request, error, {
      category: "unavailable",
      code: "AUTH_SERVICE_UNAVAILABLE",
      event: "auth.verification_failed",
      integration: "supabase-auth",
      operation: "getUser",
      retryable: true,
      statusCode: 503,
    });
    return {
      error: Response.json(
        {
          error: { code: "auth_unavailable", message: "Authentication is temporarily unavailable" },
        },
        { status: 503 },
      ),
    };
  }
  const { data, error } = result;
  const userId = relayUserIdSchema.safeParse(data.user?.id);
  if (error !== null || !userId.success) {
    if (error !== null) {
      logApiError(request, error, {
        category: "unauthorized",
        code: "AUTH_TOKEN_REJECTED",
        event: "auth.token_rejected",
        integration: "supabase-auth",
        operation: "getUser",
        retryable: false,
        statusCode: 401,
      });
    }
    return unauthorized("invalid_token", "Authentication failed");
  }

  return { accessToken: token, userId: userId.data };
}
