import { createHmac, timingSafeEqual } from "node:crypto";

/** One version of the signing secret. `versionId` is the Secrets Manager VersionId. */
export type SigningKey = { versionId: string; key: string };

export type ParsedToken = {
  versionId: string;
  expiresAt: number;
  subject: string;
  signed: string;
  signature: Buffer;
};

const VERSION = "v1";
const SUBJECT = /^[A-Za-z0-9_.@-]{1,64}$/;
const VERSION_ID = /^[A-Za-z0-9-]{1,64}$/;

const mac = (key: string, signed: string): Buffer =>
  createHmac("sha256", key).update(signed).digest();

// #region sign
/** `v1.<version id>.<expiry, Unix seconds>.<subject>.<HMAC-SHA256>`. The version id says which key to check with. */
export function signToken(key: SigningKey, subject: string, expiresAt: number): string {
  if (!SUBJECT.test(subject)) {
    throw new Error("subject must be 1 to 64 characters of A-Z a-z 0-9 _ . @ -");
  }
  const signed = [
    VERSION,
    key.versionId,
    expiresAt,
    Buffer.from(subject).toString("base64url"),
  ].join(".");
  return `${signed}.${mac(key.key, signed).toString("base64url")}`;
}
// #endregion sign

/** null for anything that is not shaped like a token. Says nothing yet about who signed it. */
export function parseToken(token: string): ParsedToken | null {
  const parts = token.split(".");
  const [version, versionId, expiry, subjectPart, signaturePart] = parts;
  if (
    parts.length !== 5 ||
    version !== VERSION ||
    versionId === undefined ||
    !VERSION_ID.test(versionId)
  ) {
    return null;
  }
  if (
    expiry === undefined ||
    !/^\d{1,12}$/.test(expiry) ||
    subjectPart === undefined ||
    signaturePart === undefined
  ) {
    return null;
  }
  const subject = Buffer.from(subjectPart, "base64url").toString("utf8");
  if (!SUBJECT.test(subject)) {
    return null;
  }
  return {
    versionId,
    expiresAt: Number(expiry),
    subject,
    signed: parts.slice(0, 4).join("."),
    signature: Buffer.from(signaturePart, "base64url"),
  };
}

// #region verify
export type Verdict = "ok" | "bad-signature" | "expired";

export function verifyToken(token: ParsedToken, key: SigningKey, nowSeconds: number): Verdict {
  const expected = mac(key.key, token.signed);
  // The signature first: an expiry that nobody signed is not worth reporting on.
  if (expected.length !== token.signature.length || !timingSafeEqual(expected, token.signature)) {
    return "bad-signature";
  }
  return token.expiresAt > nowSeconds ? "ok" : "expired";
}
// #endregion verify
