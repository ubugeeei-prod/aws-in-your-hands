import { describe, expect, it } from "vite-plus/test";
import { IMMUTABLE, REVALIDATE } from "./plan.ts";
import { assetCheckFrom, checksFor, httpsRedirectCheck, type Observed, revisionCheck } from "./smoke-spec.ts";

const htmlPage = (body: string, overrides: Partial<Observed> = {}): Observed => ({
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": REVALIDATE },
  body,
  ...overrides,
});

const find = (profile: "book" | "spa", name: string) => {
  const check = checksFor(profile).checks.find((candidate) => candidate.name === name);
  if (check === undefined) {
    throw new Error(`no check named ${name}`);
  }
  return check;
};

describe("smoke checks", () => {
  it("rejects a book that answers an unknown page with the home page", () => {
    const check = find("book", "unknown page is a real 404, not the home page");
    expect(check.verify(htmlPage('<html lang="ja">'))).toMatch(/expected status 404/);
    expect(check.verify(htmlPage("not found", { status: 404 }))).toBeNull();
  });

  it("rejects a page served in the wrong language", () => {
    const check = find("book", "English deep link");
    expect(check.verify(htmlPage('<html lang="ja" dir="ltr">'))).toMatch(/does not contain/);
    expect(check.verify(htmlPage('<html lang="en" dir="ltr">'))).toBeNull();
  });

  it("rejects a page that would be cached without revalidation", () => {
    const check = find("book", "Japanese home");
    const cached = htmlPage('<html lang="ja">', {
      headers: { "content-type": "text/html", "cache-control": IMMUTABLE },
    });
    expect(check.verify(cached)).toMatch(/cache-control/);
  });

  it("rejects a SPA that answers a missing script with HTML", () => {
    const check = find("spa", "missing asset is a 404, not the application shell");
    expect(check.verify(htmlPage('<div id="app">'))).toMatch(/expected status 404/);
  });

  it("accepts a SPA deep link served by the application shell", () => {
    expect(
      find("spa", "deep link falls back to the application shell").verify(htmlPage('<div id="app"></div>')),
    ).toBeNull();
  });

  it("fails while an older revision is still being served", () => {
    const check = revisionCheck("abc123");
    const observed = (revision: string): Observed => ({ status: 200, headers: {}, body: JSON.stringify({ revision }) });
    expect(check.verify(observed("old000"))).toBe("site serves revision old000");
    expect(check.verify(observed("abc123"))).toBeNull();
  });

  it("requires plain HTTP to redirect to HTTPS", () => {
    const check = httpsRedirectCheck("d111.cloudfront.net");
    expect(check.verify({ status: 301, headers: { location: "https://d111.cloudfront.net/" }, body: "" })).toBeNull();
    expect(check.verify({ status: 200, headers: {}, body: "" })).toMatch(/expected a redirect/);
  });

  it("finds a hashed asset from the page that links to it", () => {
    const check = assetCheckFrom('<link rel="stylesheet" href="/assets/ox-content-core-0509418ce6.css">');
    expect(check).toMatchObject({ path: "/assets/ox-content-core-0509418ce6.css" });
    expect(assetCheckFrom("<p>no assets</p>")).toBe("the page links to no /assets/ file");
  });
});
