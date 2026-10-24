/** Serialize delivery and logout in this runtime. Native generation checks guard other runtimes. */
let tail: Promise<unknown> = Promise.resolve();
const blockedTenants = new Set<string>();

export function serializeCaptureWork<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.then(work, work);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function captureWorkAllowed(tenantId: string): boolean {
  return !blockedTenants.has(tenantId);
}

export function blockCaptureWork(tenantId: string): void {
  blockedTenants.add(tenantId);
}

export function resumeCaptureWork(tenantId: string): void {
  blockedTenants.delete(tenantId);
}
