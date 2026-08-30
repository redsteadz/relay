import { withOperationDeadline } from "./deadline";

export class BoundedJsonError extends Error {
  constructor(
    readonly code: "invalid-response" | "response-too-large" | "response-unavailable",
    cause?: unknown,
  ) {
    super("Remote response is invalid", cause === undefined ? undefined : { cause });
  }
}

type BoundedJsonOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  options: BoundedJsonOptions = {},
): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) || Number(contentLength) > maximumBytes)
  ) {
    throw new BoundedJsonError("response-too-large");
  }
  if (response.body === null) throw new BoundedJsonError("invalid-response");

  const reader = response.body.getReader();
  const readBody = async (signal?: AbortSignal): Promise<Uint8Array[]> => {
    const chunks: Uint8Array[] = [];
    let length = 0;
    let cancellationError: unknown;
    const cancelReader = async (): Promise<void> => {
      try {
        await reader.cancel();
      } catch (error: unknown) {
        cancellationError = error;
      }
    };
    const cancel = (): void => {
      void cancelReader();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > maximumBytes) {
          await cancelReader();
          const error = new BoundedJsonError("response-too-large");
          if (cancellationError === undefined) throw error;
          throw new BoundedJsonError(
            "response-too-large",
            new AggregateError([cancellationError], "Response cancellation failed", {
              cause: error,
            }),
          );
        }
        chunks.push(next.value);
      }
      return chunks;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  };

  let chunks: Uint8Array[];
  try {
    chunks =
      options.timeoutMs === undefined
        ? await readBody(options.signal)
        : await withOperationDeadline(readBody, options.timeoutMs, options.signal);
  } catch (error) {
    let cancellationError: unknown;
    try {
      await reader.cancel();
    } catch (cancelError: unknown) {
      cancellationError = cancelError;
    }
    const code = error instanceof BoundedJsonError ? error.code : "response-unavailable";
    if (cancellationError === undefined && error instanceof BoundedJsonError) throw error;
    throw new BoundedJsonError(
      code,
      cancellationError === undefined
        ? error
        : new AggregateError([cancellationError], "Response cancellation failed", {
            cause: error,
          }),
    );
  }

  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch (error: unknown) {
    throw new BoundedJsonError("invalid-response", error);
  }
}
