import { describe, expect, it } from "vite-plus/test";

import { shouldLeave, viewFor, withPresence } from "./call.ts";
import { parseCallsConfig } from "./config.ts";

describe("viewFor", () => {
  it("follows the session from connecting to in-call", () => {
    expect(viewFor({ kind: "connecting", reconnecting: false })).toEqual({ name: "connecting" });
    expect(viewFor({ kind: "started" })).toEqual({ name: "in-call" });
    expect(viewFor({ kind: "connecting", reconnecting: true })).toEqual({ name: "reconnecting" });
  });

  it("tells the user when the same token was used somewhere else, and what to do", () => {
    const view = viewFor({ kind: "stopped", code: "AudioJoinedFromAnotherDevice" });
    expect(view).toMatchObject({ name: "ended" });
    expect(view.name === "ended" && view.message).toContain("join again");
  });

  it("names a status code it has no sentence for", () => {
    expect(viewFor({ kind: "stopped", code: "TaskFailed" })).toEqual({
      name: "ended",
      message: "The call stopped (TaskFailed).",
    });
  });
});

describe("shouldLeave", () => {
  it("gives the seat back after leaving or failing", () => {
    for (const code of ["Left", "TaskFailed", "AudioDisconnected", "AudioAuthenticationRejected"]) {
      expect(shouldLeave(code), code).toBe(true);
    }
  });

  it("does not end the attendee when the seat moved to another device", () => {
    expect(shouldLeave("AudioJoinedFromAnotherDevice")).toBe(false);
  });

  it("asks for nothing when the seat is already gone", () => {
    expect(shouldLeave("AudioAttendeeRemoved")).toBe(false);
    expect(shouldLeave("MeetingEnded")).toBe(false);
  });
});

describe("withPresence", () => {
  it("adds and removes a user once, whatever order the reports come in", () => {
    let present: string[] = [];
    present = withPresence(present, "bob", true);
    present = withPresence(present, "alice", true);
    present = withPresence(present, "bob", true);
    expect(present).toEqual(["alice", "bob"]);
    present = withPresence(present, "bob", false);
    present = withPresence(present, "bob", false);
    expect(present).toEqual(["alice"]);
  });
});

describe("parseCallsConfig", () => {
  const local = { apiUrl: "http://localhost:8787", auth: { mode: "local" } };

  it("needs to be told whether there is media behind the API", () => {
    expect(parseCallsConfig({ ...local, media: "none" }).media).toBe("none");
    expect(() => parseCallsConfig(local)).toThrow();
    expect(() => parseCallsConfig({ ...local, media: "maybe" })).toThrow();
  });

  it("reads the file the repository ships as local sign-in without media", async () => {
    const { readFile } = await import("node:fs/promises");
    const shipped: unknown = JSON.parse(
      await readFile(new URL("../public/config.json", import.meta.url), "utf8"),
    );
    expect(parseCallsConfig(shipped)).toEqual({ ...local, media: "none" });
  });
});
