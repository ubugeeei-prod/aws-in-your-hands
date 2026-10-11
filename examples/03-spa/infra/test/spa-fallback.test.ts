import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vite-plus/test";

type ViewerRequest = { uri: string };

const source = readFileSync(new URL("../functions/spa-fallback.js", import.meta.url), "utf8");
const handler = runInNewContext(`${source}; handler`) as (event: { request: ViewerRequest }) => ViewerRequest;
const uriFor = (uri: string): string => handler({ request: { uri } }).uri;

describe("spa-fallback function", () => {
  it.each(["/", "/notes/new", "/notes/3f2a", "/notes/3f2a/", "/anything/else"])(
    "answers the client-side route %s with the application shell",
    (uri) => {
      expect(uriFor(uri)).toBe("/index.html");
    },
  );

  it.each(["/index.html", "/assets/index-B1x2y3.js", "/assets/index-C4d5e6.css", "/favicon.svg"])(
    "passes the file request %s through",
    (uri) => {
      expect(uriFor(uri)).toBe(uri);
    },
  );

  it("does not hide a missing asset behind the application shell", () => {
    // If this returned /index.html, the browser would receive HTML with a 200
    // for a <script src>, and the real error would never surface.
    expect(uriFor("/assets/removed-in-last-deploy.js")).toBe("/assets/removed-in-last-deploy.js");
  });
});
