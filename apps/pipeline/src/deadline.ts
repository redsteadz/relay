export class OperationDeadlineError extends Error {
  constructor() {
    super("External operation deadline exceeded");
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof OperationDeadlineError
    ? signal.reason
    : new OperationDeadlineError();
}

export async function withOperationDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort(abortReason(parentSignal!));
  if (parentSignal?.aborted === true) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const timeout = setTimeout(() => controller.abort(new OperationDeadlineError()), timeoutMs);
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectAborted = (): void => reject(abortReason(controller.signal));
    if (controller.signal.aborted) rejectAborted();
    else controller.signal.addEventListener("abort", rejectAborted, { once: true });
  });
  const pending = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw abortReason(controller.signal);
    return operation(controller.signal);
  });

  try {
    return await Promise.race([pending, aborted]);
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export function deadlineFetcher(
  fetcher: (input: string, init?: RequestInit) => Promise<Response>,
  parentSignal: AbortSignal,
  timeoutMs: number,
): (input: string, init?: RequestInit) => Promise<Response> {
  return (input, init) =>
    withOperationDeadline((signal) => fetcher(input, { ...init, signal }), timeoutMs, parentSignal);
}
