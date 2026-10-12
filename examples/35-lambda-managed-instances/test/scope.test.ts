import { describe, expect, it } from "vite-plus/test";

import { asyncScope, moduleScope } from "../src/scope.ts";
import { createNote, harness, storedBy } from "./harness.ts";

const url = (path: string) => `http://api.test${path}`;

// #region interleave
/** Request A stops inside its write. Request B arrives, is answered, and only then A goes on. */
async function interleave({ app, writing, release }: ReturnType<typeof harness>) {
  const a = app(new Request(url("/notes"), createNote("from A")));
  await writing;
  const b = await app(new Request(url("/health")));
  release();
  return { a: await a, b };
}
// #endregion interleave

describe("a request ID kept in module scope", () => {
  it("is right while requests come one at a time", async () => {
    const { app, lines, release } = harness(moduleScope, ["req-A", "req-B"]);
    release();
    await app(new Request(url("/notes"), createNote("first")));
    await app(new Request(url("/notes"), createNote("second")));
    expect(storedBy(lines, "note-1")).toBe("req-A");
    expect(storedBy(lines, "note-2")).toBe("req-B");
  });

  // #region leak
  it("names the wrong request once two are in flight", async () => {
    const test = harness(moduleScope, ["req-A", "req-B"]);
    const { a, b } = await interleave(test);

    // Both callers got their own answer, with their own ID on it.
    expect(a.status).toBe(201);
    expect(a.headers.get("x-request-id")).toBe("req-A");
    expect(b.headers.get("x-request-id")).toBe("req-B");
    // But A's note is on record as written by B.
    expect(storedBy(test.lines, "note-1")).toBe("req-B");
  });
  // #endregion leak

  it("still holds the last request after it has been answered", async () => {
    const { app, release } = harness(moduleScope, ["req-A"]);
    release();
    await app(new Request(url("/health")));
    expect(moduleScope.current()).toEqual({ requestId: "req-A" });
  });
});

describe("a request ID kept in AsyncLocalStorage", () => {
  // #region fixed
  it("names the right request when two are in flight", async () => {
    const test = harness(asyncScope, ["req-A", "req-B"]);
    const { a, b } = await interleave(test);

    expect(a.headers.get("x-request-id")).toBe("req-A");
    expect(b.headers.get("x-request-id")).toBe("req-B");
    expect(storedBy(test.lines, "note-1")).toBe("req-A");
  });
  // #endregion fixed

  it("keeps many requests apart, whatever order they finish in", async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `req-${index + 1}`);
    const test = harness(asyncScope, ids);
    const first = test.app(new Request(url("/notes"), createNote("held")));
    await test.writing;
    const rest = await Promise.all(
      ids.slice(1).map((_, index) => test.app(new Request(url("/notes"), createNote(`n${index}`)))),
    );
    test.release();
    const answers = [await first, ...rest];

    for (const answer of answers) {
      const note = (await answer.json()) as { id: string };
      expect(storedBy(test.lines, note.id)).toBe(answer.headers.get("x-request-id"));
    }
    expect(new Set(answers.map((answer) => answer.headers.get("x-request-id"))).size).toBe(20);
  });

  it("holds nothing outside a request", async () => {
    const { app, release } = harness(asyncScope, ["req-A"]);
    release();
    await app(new Request(url("/health")));
    expect(asyncScope.current()).toBeUndefined();
  });
});
