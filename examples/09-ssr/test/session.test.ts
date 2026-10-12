import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { parseEnv } from "../core/env.ts";
import { createStaticNotes } from "../core/notes.ts";
import { createDevIdentity, viewerSchema } from "../core/profile.ts";
import { seedNotes } from "../core/seed.ts";
import {
  createMemorySessions,
  findSession,
  isSameOrigin,
  sessionCookieAttributes,
  sessionIdSchema,
} from "../core/session.ts";

const id = "A".repeat(43);

describe("sessions", () => {
  it("expire, and a malformed id finds nothing", () => {
    const store = createMemorySessions();
    store.put(id, { userName: "alice", accessToken: "token", expiresAt: 1000 });

    expect(findSession(store, id, 999)?.userName).toBe("alice");
    expect(findSession(store, id, 1000)).toBeUndefined();
    // Gone for good, not only hidden while the clock says so.
    expect(findSession(store, id, 0)).toBeUndefined();

    expect(findSession(store, undefined, 0)).toBeUndefined();
    expect(findSession(store, "../../etc/passwd", 0)).toBeUndefined();
    expect(v.safeParse(sessionIdSchema, id.slice(1)).success).toBe(false);
  });

  it("use a cookie that scripts cannot read and that stays under /me", () => {
    expect(sessionCookieAttributes(true)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/me",
    });
  });

  it("accept form posts from the same origin only", () => {
    expect(isSameOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
    expect(isSameOrigin("https://evil.example", "localhost:3000")).toBe(false);
    expect(isSameOrigin(undefined, "localhost:3000")).toBe(false);
    expect(isSameOrigin("null", "localhost:3000")).toBe(false);
  });
});

describe("the BFF boundary", () => {
  it("has no field in the browser-facing shape that could carry a token", async () => {
    const identity = createDevIdentity({
      now: () => new Date("2026-10-11T00:00:00.000Z"),
      newToken: () => "secret",
    });
    const { accessToken } = identity.signIn("alice");
    const profile = await identity.profile(accessToken);

    // Extra keys are dropped by the schema, so a token added by mistake would not pass through.
    const viewer = v.parse(viewerSchema, { signedIn: true, profile: { ...profile, accessToken } });
    expect(JSON.stringify(viewer)).not.toContain("secret");
    expect(await identity.profile("another-token")).toBeUndefined();
  });
});

describe("parseEnv", () => {
  it("keeps sign-in off unless asked, and refuses the practice sign-in on Lambda", () => {
    expect(parseEnv({})).toEqual({ stage: "local", signIn: "off" });
    expect(parseEnv({ AIH_SSR_SIGN_IN: "dev" }).signIn).toBe("dev");
    expect(() =>
      parseEnv({ AIH_SSR_SIGN_IN: "dev", AWS_LAMBDA_FUNCTION_NAME: "AihSsr-Server" }),
    ).toThrow(/Lambda/);
    expect(() => parseEnv({ AIH_SSR_SIGN_IN: "yes" })).toThrow(/AIH_SSR_SIGN_IN/);
  });
});

describe("seed notes", () => {
  it("pass the schema and list newest first", () => {
    const notes = createStaticNotes(seedNotes).list();
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.map((note) => note.updatedAt)).toEqual(
      notes
        .map((note) => note.updatedAt)
        .toSorted()
        .toReversed(),
    );
    expect(() => createStaticNotes([notes[0], notes[0]])).toThrow(/duplicate/);
  });
});
