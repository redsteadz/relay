const SYNTHETIC_LOCAL_NOTIFICATION_TENANT_ID =
  "relay-synthetic-local-development-notification-capture";

export type NotificationCaptureMode = {
  cleanupTenantId: string | undefined;
  developmentLocal: boolean;
  stateKey: string;
  tenantId: string | undefined;
};

/**
 * Diagnostic builds set `EXPO_PUBLIC_RELAY_LOCAL_DIAGNOSTICS=disabled` so they reproduce the
 * release runtime exactly: capture stays authenticated and the synthetic local tenant is never
 * prepared, which would otherwise clear the signed-in tenant's queue and configuration.
 */
export function localDiagnosticsDisabled(): boolean {
  return process.env.EXPO_PUBLIC_RELAY_LOCAL_DIAGNOSTICS === "disabled";
}

export function localDevelopmentAccessEnabled(
  isDevelopment: boolean,
  buildVariant: unknown,
  diagnosticsDisabled = false,
): boolean {
  if (diagnosticsDisabled) return false;
  return isDevelopment && (buildVariant === "development" || buildVariant === "sideload");
}

export function canEnterApp(hasSession: boolean, localDevelopmentAccess: boolean): boolean {
  return hasSession || localDevelopmentAccess;
}

/**
 * Local development access only bypasses the app-shell guard for native capture diagnostics. It
 * must never hide the real sign-in route: category RLS and authenticated Relay APIs still require
 * a Supabase session.
 */
export function canEnterSignIn(hasSession: boolean): boolean {
  return !hasSession;
}

export function notificationCaptureTenantId(
  authenticatedTenantId: string | undefined,
  localDevelopmentAccess: boolean,
  platform: string,
): string | undefined {
  return notificationCaptureMode(authenticatedTenantId, localDevelopmentAccess, platform).tenantId;
}

export function notificationCaptureMode(
  authenticatedTenantId: string | undefined,
  localDevelopmentAccess: boolean,
  platform: string,
): NotificationCaptureMode {
  const developmentLocal =
    authenticatedTenantId === undefined && localDevelopmentAccess && platform === "android";
  const tenantId = developmentLocal
    ? SYNTHETIC_LOCAL_NOTIFICATION_TENANT_ID
    : authenticatedTenantId;

  return {
    cleanupTenantId:
      platform === "android" && !developmentLocal
        ? SYNTHETIC_LOCAL_NOTIFICATION_TENANT_ID
        : undefined,
    developmentLocal,
    stateKey:
      authenticatedTenantId === undefined
        ? developmentLocal
          ? "development-local"
          : `unavailable:${platform}`
        : `authenticated:${authenticatedTenantId}`,
    tenantId,
  };
}
