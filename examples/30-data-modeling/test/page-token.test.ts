import { describe, expect, it } from "vite-plus/test";

import { decodePageToken, encodePageToken, InvalidPageTokenError } from "../src/page-token.ts";

const encode = (value: unknown): string =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

describe("page tokens", () => {
  it("come back as the position they were made from", () => {
    const position = {
      list: "recent",
      updatedAt: "2026-10-13T00:00:00.000Z",
      noteId: "n1",
    } as const;
    expect(decodePageToken(encodePageToken(position))).toEqual(position);
  });

  it("carry no key attribute names and no owner", () => {
    const token = encodePageToken({ list: "tag", tag: "trip", noteId: "n1" });
    const text = Buffer.from(token, "base64url").toString("utf8");
    expect(text).not.toMatch(/pk|sk|gsi|OWNER/);
  });

  it("are refused when they are anything but a position", () => {
    const bad = [
      "",
      "%%%",
      encode("text"),
      encode({ list: "recent", updatedAt: "yesterday", noteId: "n1" }),
      encode({ list: "recent", updatedAt: "2026-10-13T00:00:00.000Z", noteId: "n1#x" }),
      // A raw LastEvaluatedKey, as a client might try.
      encode({ pk: "OWNER#someone-else", sk: "NOTE#n1" }),
      // One field too many: a strict object, so nothing rides along.
      encode({ list: "tag", tag: "trip", noteId: "n1", pk: "OWNER#someone-else" }),
      encode({ list: "tag", tag: "Trip#x", noteId: "n1" }),
      "A".repeat(513),
    ];
    for (const token of bad) {
      expect(() => decodePageToken(token)).toThrow(InvalidPageTokenError);
    }
  });
});
