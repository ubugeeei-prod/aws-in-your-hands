// #region read
export type BodyRead = { ok: true; text: string } | { ok: false; reason: "too_large" };

/** The one method of an SDK response body this needs, in Node.js and in a browser alike. */
export type StreamingBody = { transformToWebStream: () => ReadableStream<Uint8Array> };

/**
 * Reads a response body as UTF-8, and stops at `maxBytes`. `transformToString()` reads whatever
 * the object holds into memory; an attachment's size is the uploader's choice, not the reader's.
 */
export async function readText(body: StreamingBody, maxBytes: number): Promise<BodyRead> {
  const reader = body.transformToWebStream().getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
    }
    size += value.byteLength;
    if (size > maxBytes) {
      // Cancelling closes the socket, so it goes back to the agent instead of staying held.
      await reader.cancel();
      return { ok: false, reason: "too_large" };
    }
    chunks.push(value);
  }
}
// #endregion read
