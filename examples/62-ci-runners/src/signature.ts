import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";
const HEX = /^[0-9a-f]{64}$/;

// #region sign
/** What GitHub puts in X-Hub-Signature-256: an HMAC-SHA256 of the body's bytes, in hex. */
export function sign(secret: string, body: Uint8Array): string {
  return PREFIX + createHmac("sha256", secret).update(body).digest("hex");
}
// #endregion sign

// #region verify
/** True only for the signature this secret gives these exact bytes. */
export function verify(secret: string, body: Uint8Array, header: string | null): boolean {
  if (secret === "" || header === null || !header.startsWith(PREFIX)) {
    return false;
  }
  const given = header.slice(PREFIX.length);
  // Anything that is not 64 hex digits would make the two buffers differ in length.
  if (!HEX.test(given)) {
    return false;
  }
  const expected = sign(secret, body).slice(PREFIX.length);
  // Not `===`: how long a comparison takes must not say how many digits were right.
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}
// #endregion verify
