import { withOperationDeadline } from "./deadline";

export class BoundedJsonError extends Error {
  constructor(readonly code: "invalid-response" | "response-too-large" | "response-unavailable") {
    super("Remote response is invalid");
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
    const cancel = (): void => {
      void reader.cancel().catch(() => undefined);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.byteLength;
        if (length > maximumBytes) {
          await reader.cancel().catch(() => undefined);
          throw new BoundedJsonError("response-too-large");
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
    void reader.cancel().catch(() => undefined);
    if (error instanceof BoundedJsonError) throw error;
    throw new BoundedJsonError("response-unavailable");
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
  } catch {
    throw new BoundedJsonError("invalid-response");
  }
}
