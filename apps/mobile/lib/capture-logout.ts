import { blockCaptureWork, resumeCaptureWork, serializeCaptureWork } from "./capture-work";

type LogoutOperations = {
  prepare: (tenantId: string) => Promise<void>;
  finishCaptures: (tenantId: string, discard: boolean) => Promise<number>;
  clearDerived: (tenantId: string) => Promise<void>;
  clearCaches: () => Promise<void>;
  clearSession: () => Promise<void>;
};

/** Zero means signed out. A positive count requires a fresh, explicit user decision. */
export async function finishCaptureSignOut(
  tenantId: string | undefined,
  discard: boolean,
  operations: LogoutOperations,
): Promise<number> {
  if (tenantId !== undefined) blockCaptureWork(tenantId);
  let completed = false;
  try {
    return await serializeCaptureWork(async () => {
      if (tenantId !== undefined) {
        await operations.prepare(tenantId);
        const pending = await operations.finishCaptures(tenantId, discard);
        if (pending > 0) return pending;
        await operations.clearDerived(tenantId);
      }
      await operations.clearCaches();
      await operations.clearSession();
      completed = true;
      return 0;
    });
  } finally {
    if (!completed && tenantId !== undefined) resumeCaptureWork(tenantId);
  }
}
