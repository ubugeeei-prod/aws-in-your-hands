import { describe, expect, it } from "vite-plus/test";

import { planAssets } from "../scripts/asset-plan.ts";

const now = new Date("2026-10-11T00:00:00.000Z");
const daysAgo = (days: number): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const local = (key: string, md5 = "aaa") => ({ key, md5, size: 1 });
const remote = (key: string, age: number, etag = '"aaa"') => ({
  key,
  etag,
  lastModified: daysAgo(age),
});

describe("planAssets", () => {
  it("adds new files first and moves the build pointer last", () => {
    const plan = planAssets({
      local: [
        local("_nuxt/new.js"),
        local("_nuxt/kept.js"),
        local("_nuxt/builds/latest.json", "bbb"),
      ],
      remote: [remote("_nuxt/kept.js", 1), remote("_nuxt/builds/latest.json", 1)],
      now,
      retentionDays: 7,
    });
    expect(plan.upload.map((item) => item.key)).toEqual(["_nuxt/new.js"]);
    expect(plan.upload[0]?.cacheControl).toContain("immutable");
    expect(plan.uploadLast).toEqual([
      expect.objectContaining({
        key: "_nuxt/builds/latest.json",
        cacheControl: "public, max-age=0, must-revalidate",
      }),
    ]);
    expect(plan.unchanged).toBe(1);
  });

  it("keeps the previous build's files while cached HTML may still ask for them", () => {
    const plan = planAssets({
      local: [local("_nuxt/new.js")],
      remote: [remote("_nuxt/previous.js", 1), remote("_nuxt/ancient.js", 8)],
      now,
      retentionDays: 7,
    });
    expect(plan.remove).toEqual(["_nuxt/ancient.js"]);
    expect(plan.retained).toBe(1);
  });

  it("refuses an empty build, and files the distribution would never serve", () => {
    expect(() =>
      planAssets({ local: [], remote: [remote("_nuxt/a.js", 30)], now, retentionDays: 7 }),
    ).toThrow(/no files/);
    expect(() =>
      planAssets({
        local: [local("_nuxt/a.js"), local("favicon.ico")],
        remote: [],
        now,
        retentionDays: 7,
      }),
    ).toThrow(/favicon\.ico/);
  });
});
