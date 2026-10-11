import { describe, expect, it } from "vite-plus/test";
import { parseRoute, pathFor } from "./route.ts";

describe("routes", () => {
  it.each([
    ["/", { name: "list" }],
    ["/notes/new", { name: "new" }],
    ["/notes/abc-123", { name: "note", id: "abc-123" }],
    ["/notes/abc-123/", { name: "note", id: "abc-123" }],
  ])("parses %s", (path, route) => {
    expect(parseRoute(path)).toEqual(route);
  });

  it("reports an unknown path instead of showing the list", () => {
    expect(parseRoute("/settings")).toEqual({ name: "not-found", path: "/settings" });
    expect(parseRoute("/notes/a/b")).toEqual({ name: "not-found", path: "/notes/a/b" });
  });

  it("round-trips an id that needs escaping", () => {
    const route = { name: "note", id: "a b/c" } as const;
    expect(parseRoute(pathFor(route))).toEqual(route);
  });
});
