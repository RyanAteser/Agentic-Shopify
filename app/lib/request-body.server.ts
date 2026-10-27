/**
 * Bound incoming webhook bodies BEFORE buffering or parsing JSON.
 *
 * Content-Length is only an early-rejection hint: chunked requests and
 * dishonest/missing headers are limited by the bytes actually received.
 * A single preallocated buffer prevents unbounded arrays of tiny chunks.
 */
export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Payload too large");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readBoundedRequestText(request: Request, maxBytes: number): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return "";

  const reader = request.body.getReader();
  const buffer = Buffer.allocUnsafe(maxBytes);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - size) {
        throw new RequestBodyTooLargeError();
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
    return buffer.toString("utf8", 0, size);
  } catch (error) {
    // Stop consuming the upstream body after the limit or a stream error.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
