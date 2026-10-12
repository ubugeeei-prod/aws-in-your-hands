// Reading a JSON body without trusting how large it says it is.

export type JsonBody =
  | { ok: true; value: unknown }
  | { ok: false; reason: "too_large" | "invalid_json" };

// #region read-json
export async function readJson(request: Request, maxBytes: number): Promise<JsonBody> {
  // The cheap check. A caller can leave the header out, or lie in it, so it is not the only one.
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body !== null) {
    // Count while reading, and stop at the limit instead of holding the rest in memory.
    for await (const chunk of request.body) {
      size += chunk.byteLength;
      if (size > maxBytes) {
        return { ok: false, reason: "too_large" };
      }
      chunks.push(chunk);
    }
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}
// #endregion read-json
