import RelayDeviceIngress from "../modules/relay-device-ingress";

let generation = 0;

/** Shared by foreground and headless entry points; never depends on a React effect. */
export async function prepareCaptureTenant(
  tenantId: string | undefined,
  cleanupTenantId?: string,
  allowAccountCleanup = true,
): Promise<void> {
  generation = Math.max(Date.now(), generation + 1);
  await RelayDeviceIngress.prepareNotificationCaptureState(
    tenantId,
    cleanupTenantId,
    generation,
    allowAccountCleanup,
  );
}
