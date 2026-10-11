import { describe, expect, it } from "vite-plus/test";
import { cacheControlFor, contentTypeFor, IMMUTABLE, planPublish, REVALIDATE } from "./plan.ts";

const now = new Date("2026-10-11T00:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const local = (key: string, md5 = `md5-${key}`) => ({ key, md5, size: 1 });
const remote = (key: string, etag = `"md5-${key}"`, lastModified = daysAgo(1)) => ({ key, etag, lastModified });

const plan = (overrides: Partial<Parameters<typeof planPublish>[0]>) =>
  planPublish({ local: [local("index.html")], remote: [], now, assetRetentionDays: 30, force: false, ...overrides });

describe("publish plan", () => {
  it("caches hashed assets for a year and makes everything else revalidate", () => {
    expect(cacheControlFor("assets/ox-content-core-0509418ce6.css")).toBe(IMMUTABLE);
    expect(cacheControlFor("ja/chapters/03-spa/index.html")).toBe(REVALIDATE);
    // Not hashed, and fetched by the search box of an already loaded page.
    expect(cacheControlFor("search-index.json")).toBe(REVALIDATE);
  });

  it("uploads assets in a phase before the pages that refer to them", () => {
    const result = plan({ local: [local("index.html"), local("ja/index.html"), local("assets/app-1a2b.js")] });
    expect(result.uploadAssets.map((upload) => upload.key)).toEqual(["assets/app-1a2b.js"]);
    expect(result.uploadPages.map((upload) => upload.key)).toEqual(["index.html", "ja/index.html"]);
  });

  it("skips files whose bytes are already in the bucket", () => {
    const result = plan({
      local: [local("index.html"), local("ja/index.html", "new")],
      remote: [remote("index.html"), remote("ja/index.html", '"old"')],
    });
    expect(result.uploadPages.map((upload) => upload.key)).toEqual(["ja/index.html"]);
    expect(result.unchanged).toBe(1);
  });

  it("re-uploads everything when forced, so that changed headers are rewritten", () => {
    const result = plan({ local: [local("index.html")], remote: [remote("index.html")], force: true });
    expect(result.uploadPages).toHaveLength(1);
  });

  it("deletes a page that is no longer built", () => {
    const result = plan({ remote: [remote("index.html"), remote("ja/removed/index.html")] });
    expect(result.deletePages).toEqual(["ja/removed/index.html"]);
  });

  it("keeps a recently replaced asset for readers who still hold the old page", () => {
    const result = plan({
      remote: [remote("assets/app-old.js", '"x"', daysAgo(3)), remote("assets/app-ancient.js", '"y"', daysAgo(45))],
    });
    expect(result.deleteAssets).toEqual(["assets/app-ancient.js"]);
    expect(result.retainedAssets).toBe(1);
  });

  it("refuses a build without index.html instead of planning to delete the site", () => {
    expect(() => plan({ local: [], remote: [remote("index.html")] })).toThrow(/no index.html/);
  });

  it("refuses to publish a file type it has no content type for", () => {
    expect(() => contentTypeFor("download.bin")).toThrow(/No content type/);
    expect(contentTypeFor("ja/index.html")).toBe("text/html; charset=utf-8");
  });
});
