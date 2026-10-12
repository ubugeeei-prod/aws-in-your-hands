import { readFileSync } from "node:fs";

import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { edgeDataSchema, toEntries } from "../../src/kvs/config.ts";
import {
  type GeneratedResponse,
  isGeneratedResponse,
  type KvsStandIn,
  loadViewerRequestFunction,
  mapKvs,
  viewerRequest,
  type ViewerRequestEvent,
} from "../../src/local/load-function.ts";

const file = new URL("../functions/edge-router.js", import.meta.url);
const source = readFileSync(file, "utf8");

const shipped = toEntries(
  v.parse(
    edgeDataSchema,
    JSON.parse(readFileSync(new URL("../../edge-data.json", import.meta.url), "utf8")),
  ),
);
const withEntries = (overrides: Record<string, string>) =>
  new Map([...shipped, ...Object.entries(overrides)]);

async function run(entries: ReadonlyMap<string, string>, event: ViewerRequestEvent) {
  const kvs = mapKvs(entries);
  const result = await loadViewerRequestFunction(file, kvs)(event);
  return { result, reads: kvs.reads };
}
const uriOf = async (entries: ReadonlyMap<string, string>, uri: string): Promise<string> => {
  const { result } = await run(entries, viewerRequest(uri));
  if (isGeneratedResponse(result)) {
    throw new Error(`expected ${uri} to reach the origin, got ${result.statusCode}`);
  }
  return result.uri;
};
const responseOf = async (
  entries: ReadonlyMap<string, string>,
  event: ViewerRequestEvent,
): Promise<GeneratedResponse> => {
  const { result } = await run(entries, event);
  if (!isGeneratedResponse(result)) {
    throw new Error(`expected a generated response, got a request for ${result.uri}`);
  }
  return result;
};

describe("edge-router: rewrites", () => {
  it.each([
    ["/", "/index.html"],
    ["/pricing/", "/pricing/index.html"],
    ["/assets/app.css", "/assets/app.css"],
    ["/missing", "/missing"],
  ])("sends %s to the origin as %s", async (uri, expected) => {
    expect(await uriOf(shipped, uri)).toBe(expected);
  });

  it("serves the new home page only while the flag is on", async () => {
    expect(await uriOf(withEntries({ "flag:new-home": "on" }), "/")).toBe("/home-v2.html");
    expect(await uriOf(withEntries({ "flag:new-home": "off" }), "/")).toBe("/index.html");
    expect(await uriOf(withEntries({ "flag:new-home": "on" }), "/pricing/")).toBe(
      "/pricing/index.html",
    );
  });
});

describe("edge-router: redirects", () => {
  it("redirects a listed path with the listed status", async () => {
    const response = await responseOf(shipped, viewerRequest("/plans"));
    expect(response.statusCode).toBe(301);
    expect(response.headers?.["location"]?.value).toBe("/pricing/");
    expect(response.headers?.["cache-control"]?.value).toBe("public, max-age=300");
  });

  it("carries the query string over, unless the target has its own", async () => {
    expect(
      (await responseOf(shipped, viewerRequest("/plans", { ref: "mail" }))).headers?.["location"]
        ?.value,
    ).toBe("/pricing/?ref=mail");
    const sale = await responseOf(shipped, viewerRequest("/sale", { ref: "mail" }));
    expect(sale.statusCode).toBe(302);
    expect(sale.headers?.["location"]?.value).toBe("/pricing/?campaign=autumn");
  });

  it.each([
    ["another site", '{"to":"https://example.org/","status":301}'],
    ["a protocol-relative URL", '{"to":"//example.org/","status":301}'],
    ["a backslash that browsers read as a slash", '{"to":"/\\\\example.org/","status":301}'],
    ["itself", '{"to":"/go","status":301}'],
    ["a status that is not a redirect", '{"to":"/pricing/","status":200}'],
    ["a status given as text", '{"to":"/pricing/","status":"301"}'],
    ["something that is not JSON", "/pricing/"],
    ["JSON that is not an object", "null"],
  ])("ignores a stored rule that points at %s", async (_label, value) => {
    // The store can be edited from the console, past every check in the sync script.
    expect(await uriOf(withEntries({ "redirect:/go": value }), "/go")).toBe("/go");
  });
});

describe("edge-router: maintenance", () => {
  const maintenance = withEntries({ "flag:maintenance": "on" });

  it.each(["/", "/pricing/", "/plans", "/assets/app.css"])(
    "answers %s with 503 and never reaches the origin",
    async (uri) => {
      const response = await responseOf(maintenance, viewerRequest(uri));
      expect(response.statusCode).toBe(503);
      expect(response.headers?.["cache-control"]?.value).toBe("no-store");
      expect(response.headers?.["retry-after"]?.value).toBe("120");
      expect(response.body?.data).toContain("maintenance");
    },
  );

  it("treats anything other than the exact word as off", async () => {
    for (const value of ["off", "ON", "true", ""]) {
      expect(await uriOf(withEntries({ "flag:maintenance": value }), "/")).toBe("/index.html");
    }
  });
});

describe("edge-router: the path that runs Lambda@Edge", () => {
  it.each(["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "refuses %s /digest before the store is read or the origin side runs",
    async (method) => {
      const { result, reads } = await run(shipped, viewerRequest("/digest", {}, method));
      expect(result).toMatchObject({ statusCode: 405 });
      expect(isGeneratedResponse(result) && result.headers?.["allow"]?.value).toBe("POST");
      expect(isGeneratedResponse(result) && result.headers?.["cache-control"]?.value).toBe(
        "no-store",
      );
      expect(reads).toEqual([]);
    },
  );

  it("lets a POST to /digest through, still behind the maintenance switch", async () => {
    expect((await run(shipped, viewerRequest("/digest", {}, "POST"))).result).toMatchObject({
      uri: "/digest",
      method: "POST",
    });
    const closed = withEntries({ "flag:maintenance": "on" });
    expect((await run(closed, viewerRequest("/digest", {}, "POST"))).result).toMatchObject({
      statusCode: 503,
    });
  });

  it("leaves other methods alone on every other path", async () => {
    // Only /digest accepts them at all; elsewhere CloudFront allows GET and HEAD only.
    expect((await run(shipped, viewerRequest("/digest/", {}, "GET"))).result).toMatchObject({
      uri: "/digest/index.html",
    });
    expect((await run(shipped, viewerRequest("/pricing/", {}, "HEAD"))).result).toMatchObject({
      uri: "/pricing/index.html",
    });
  });
});

describe("edge-router: when the store does not answer", () => {
  it("keeps serving from an empty store", async () => {
    // The state right after the first deploy, before the first sync.
    const empty = new Map<string, string>();
    expect(await uriOf(empty, "/")).toBe("/index.html");
    expect(await uriOf(empty, "/plans")).toBe("/plans");
  });

  it("keeps serving when every read fails", async () => {
    const broken: KvsStandIn = { get: () => Promise.reject(new Error("store unavailable")) };
    const result = await loadViewerRequestFunction(file, broken)(viewerRequest("/pricing/"));
    expect(result).toMatchObject({ uri: "/pricing/index.html" });
  });
});

describe("edge-router: what it costs and where it can run", () => {
  it("reads the store once for a file, twice for a page, three times for the home page", async () => {
    expect((await run(shipped, viewerRequest("/assets/app.css"))).reads).toEqual([
      "flag:maintenance",
    ]);
    expect((await run(shipped, viewerRequest("/pricing/"))).reads).toEqual([
      "flag:maintenance",
      "redirect:/pricing/",
    ]);
    expect((await run(shipped, viewerRequest("/"))).reads).toEqual([
      "flag:maintenance",
      "redirect:/",
      "flag:new-home",
    ]);
  });

  it("does not look up a path too long to be a key", async () => {
    const long = `/${"a".repeat(300)}`;
    expect((await run(shipped, viewerRequest(long))).reads).toEqual(["flag:maintenance"]);
  });

  it("fits in the 10 KB a function may be", () => {
    expect(Buffer.byteLength(source, "utf8")).toBeLessThan(10 * 1024);
  });

  it("avoids syntax that Node accepts and the documented runtime does not list", () => {
    // A text search, not a parser. It catches the slips that are easy to make coming from Node.
    const code = source
      .replaceAll(/\/\/.*$/gm, "")
      .replaceAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    const unlisted: [string, RegExp][] = [
      ["optional chaining", /\?\./],
      ["nullish coalescing", /\?\?/],
      ["spread or rest", /\.\.\./],
      ["class", /\bclass\s/],
      ["for...of", /\bfor\s*\([^)]*\sof\s/],
      ["destructuring", /\b(?:const|let|var)\s*[{[]/],
      ["a second import", /\bimport\b/],
      ["require", /\brequire\s*\(/],
      ["a timer", /\bset(?:Timeout|Interval|Immediate)\b/],
      ["network access", /\b(?:fetch|XMLHttpRequest)\b/],
      ["process or environment access", /\bprocess\b/],
    ];
    const withoutKvsImport = code.replace(/^import cf from "";\n/, "");
    expect(
      unlisted.filter(([, pattern]) => pattern.test(withoutKvsImport)).map(([name]) => name),
    ).toEqual([]);
  });
});
