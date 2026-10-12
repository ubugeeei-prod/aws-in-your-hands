import { describe, expect, it } from "vite-plus/test";

import { parseRoute, pathFor } from "./route.ts";

describe("routes", () => {
  it("recognizes the sign-in callback path", () => {
    expect(parseRoute("/callback")).toEqual({ name: "callback" });
  });

  it("does not treat a longer path as the callback", () => {
    expect(parseRoute("/callback/extra")).toEqual({ name: "not-found", path: "/callback/extra" });
  });

  it("round-trips note routes", () => {
    for (const route of [
      { name: "list" },
      { name: "new" },
      { name: "note", id: "0mgm8u3k00seed1" },
    ] as const) {
      expect(parseRoute(pathFor(route))).toEqual(route);
    }
  });
});
