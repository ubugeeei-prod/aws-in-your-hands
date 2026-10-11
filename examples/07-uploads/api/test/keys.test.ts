import { describe, expect, it } from "vite-plus/test";
import { objectKey, parseObjectKey } from "../src/keys.ts";

describe("object keys", () => {
  it("puts the owner first, so one prefix is one user", () => {
    expect(objectKey({ owner: "alice", noteId: "n1", attachmentId: "a1" })).toBe("u/alice/n1/a1");
  });

  it("refuses any part that could step outside its place", () => {
    for (const bad of ["", "a/b", "..", "a b", "a%2Fb", "x".repeat(65)]) {
      expect(() => objectKey({ owner: bad, noteId: "n1", attachmentId: "a1" }), bad).toThrow();
      expect(() => objectKey({ owner: "alice", noteId: bad, attachmentId: "a1" }), bad).toThrow();
      expect(() => objectKey({ owner: "alice", noteId: "n1", attachmentId: bad }), bad).toThrow();
    }
  });

  it("reads back only keys of its own shape", () => {
    expect(parseObjectKey("u/alice/n1/a1")).toEqual({ owner: "alice", noteId: "n1", attachmentId: "a1" });
    for (const other of ["alice/n1/a1", "u/alice/n1", "u/alice/n1/a1/extra", "u/alice//a1", "u/../n1/a1"]) {
      expect(parseObjectKey(other), other).toBeUndefined();
    }
  });
});
