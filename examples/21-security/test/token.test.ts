import { describe, expect, it } from "vite-plus/test";

import { parseToken, signToken, verifyToken } from "../src/token.ts";

const key = { versionId: "v1", key: "k".repeat(48) };
const other = { versionId: "v1", key: "j".repeat(48) };

describe("tokens", () => {
  it("round-trips the subject, the expiry, and the key version", () => {
    const parsed = parseToken(signToken(key, "alice@example.com", 2_000));
    expect(parsed).toMatchObject({
      versionId: "v1",
      subject: "alice@example.com",
      expiresAt: 2_000,
    });
    expect(parsed && verifyToken(parsed, key, 1_999)).toBe("ok");
    expect(parsed && verifyToken(parsed, key, 2_000)).toBe("expired");
  });

  it("rejects a token signed with another key, even one filed under the same version id", () => {
    const parsed = parseToken(signToken(other, "alice", 2_000));
    expect(parsed && verifyToken(parsed, key, 0)).toBe("bad-signature");
  });

  it("rejects a token whose expiry or subject was edited after signing", () => {
    const [v, id, , subject, signature] = signToken(key, "alice", 2_000).split(".");
    const later = parseToken([v, id, 9_999_999, subject, signature].join("."));
    expect(later && verifyToken(later, key, 0)).toBe("bad-signature");
    const mallory = parseToken(
      [v, id, 2_000, Buffer.from("mallory").toString("base64url"), signature].join("."),
    );
    expect(mallory && verifyToken(mallory, key, 0)).toBe("bad-signature");
  });

  it("reports a forged token as forged, not as expired", () => {
    const [v, id, , subject, signature] = signToken(other, "alice", 1).split(".");
    const parsed = parseToken([v, id, 1, subject, signature].join("."));
    expect(parsed && verifyToken(parsed, key, 100)).toBe("bad-signature");
  });

  it.each([
    "",
    "v1.v1.2000.YWxpY2U",
    "v2.v1.2000.YWxpY2U.AAAA",
    "v1.../../x.2000.YWxpY2U.AAAA",
    "v1.v1.soon.YWxpY2U.AAAA",
  ])("does not parse %j", (token) => {
    expect(parseToken(token)).toBeNull();
  });

  it("refuses to sign a subject that would not survive the format", () => {
    expect(() => signToken(key, "a.b c", 1)).toThrow("subject");
  });
});
