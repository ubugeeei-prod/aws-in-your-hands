import { describe, expect, it } from "vite-plus/test";

import { encodeEvent } from "../src/events.ts";

describe("note events", () => {
  it("encodes an event as the text that gets hashed", () => {
    expect(encodeEvent({ type: "note.created", noteId: "n1", actor: "user-1", version: 1 })).toBe(
      '{"type":"note.created","noteId":"n1","actor":"user-1","version":1}',
    );
  });

  it("refuses a field it does not know, such as the note's body", () => {
    const withBody = { type: "note.created", noteId: "n1", actor: "user-1", version: 1, body: "x" };
    expect(() => encodeEvent(withBody as never)).toThrow();
  });

  it("takes a hash of the body, and only a hash", () => {
    const event = { type: "note.updated" as const, noteId: "n1", actor: "user-1", version: 2 };
    expect(() => encodeEvent({ ...event, bodySha256: "f".repeat(64) })).not.toThrow();
    expect(() => encodeEvent({ ...event, bodySha256: "the body itself" })).toThrow();
  });
});
