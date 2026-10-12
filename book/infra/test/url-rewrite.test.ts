import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vite-plus/test";

type QueryValue = { value: string; multiValue?: { value: string }[] };
type ViewerRequest = { uri: string; querystring: Record<string, QueryValue> };
type Redirect = { statusCode: number; headers: Record<string, { value: string }> };

// Runs the deployed file itself. node:vm checks the logic, not the runtime's limits.
const source = readFileSync(new URL("../functions/url-rewrite.js", import.meta.url), "utf8");
const handler = runInNewContext(`${source}; handler`) as (event: {
  request: ViewerRequest;
}) => ViewerRequest | Redirect;

const run = (uri: string, querystring: Record<string, QueryValue> = {}) =>
  handler({ request: { uri, querystring } });

describe("book url-rewrite function", () => {
  it.each([
    ["/", "/index.html"],
    ["/ja/", "/ja/index.html"],
    ["/en/chapters/03-spa/", "/en/chapters/03-spa/index.html"],
  ])("maps %s to index.html", (uri, key) => {
    expect(run(uri)).toMatchObject({ uri: key });
  });

  it.each([
    "/ja/chapters/03-spa/index.html",
    "/assets/ox-content-core-0509418ce6.css",
    "/search-index.json",
    "/404.html",
  ])("leaves %s alone", (uri) => {
    expect(run(uri)).toMatchObject({ uri });
  });

  it("redirects a URL without a trailing slash", () => {
    const response = run("/ja/chapters/03-spa") as Redirect;
    expect(response.statusCode).toBe(301);
    expect(response.headers["location"]?.value).toBe("/ja/chapters/03-spa/");
  });

  it("keeps the query string on that redirect", () => {
    const response = run("/en", {
      q: { value: "s3" },
      tag: { value: "a", multiValue: [{ value: "a" }, { value: "b" }] },
      flag: { value: "" },
    }) as Redirect;
    expect(response.headers["location"]?.value).toBe("/en/?q=s3&tag=a&tag=b&flag");
  });

  it("does not turn an unknown path into the home page", () => {
    // A fallback to one HTML file would hide broken links.
    expect(run("/ja/no-such-page/")).toMatchObject({ uri: "/ja/no-such-page/index.html" });
  });
});
