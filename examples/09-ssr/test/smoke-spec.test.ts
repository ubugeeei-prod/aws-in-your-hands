import { describe, expect, it } from "vite-plus/test";
import { NO_STORE, SHARED } from "../core/cache-control.ts";
import {
  directUrlProblem,
  firstAssetPath,
  type Observed,
  personalPageProblem,
  publicPageProblem,
} from "../scripts/smoke-spec.ts";

const page = (cacheControl: string, extra: Record<string, string> = {}): Observed => ({
  status: 200,
  headers: { "cache-control": cacheControl, ...extra },
  body: "",
});
const hit = { "x-cache": "Hit from cloudfront" };
const miss = { "x-cache": "Miss from cloudfront" };

describe("smoke checks", () => {
  it("want a public page to be reused, and to carry no cookie", () => {
    expect(publicPageProblem(page(SHARED, miss), [page(SHARED, hit)])).toBeNull();
    expect(publicPageProblem(page(SHARED, miss), [page(SHARED, miss)])).toMatch(/never answered from its cache/);
    expect(publicPageProblem(page(SHARED, { ...miss, "set-cookie": "a=b" }), [page(SHARED, hit)])).toMatch(/cookie/);
    expect(publicPageProblem(page(NO_STORE, miss), [page(NO_STORE, miss)])).toMatch(/expected cache-control/);
  });

  it("fail a personal page that CloudFront reused even once", () => {
    expect(personalPageProblem([page(NO_STORE, miss), page(NO_STORE, miss)])).toBeNull();
    expect(personalPageProblem([page(NO_STORE, miss), page(NO_STORE, hit)])).toMatch(/answered from its cache/);
    expect(personalPageProblem([page(NO_STORE, { ...miss, age: "3" })])).toMatch(/answered from its cache/);
    expect(personalPageProblem([page(SHARED, miss)])).toMatch(/expected cache-control/);
  });

  it("fail a function URL that answers without CloudFront", () => {
    expect(directUrlProblem({ status: 403, headers: {}, body: "" })).toBeNull();
    expect(directUrlProblem({ status: 200, headers: {}, body: "" })).toMatch(/unsigned/);
  });

  it("find a built asset in the page", () => {
    expect(firstAssetPath('<link rel="stylesheet" href="/_nuxt/entry.abc.css">')).toBe("/_nuxt/entry.abc.css");
    expect(firstAssetPath("<p>no assets</p>")).toBeUndefined();
  });
});
