import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { LIMITS } from "../src/names.ts";
import { limitsSchema, parseRelease, peakConcurrency, shares } from "../src/release.ts";

const context = (values: Record<string, string>) => (key: string) => values[key];
const accepts = (limits: Record<string, number>) =>
  v.safeParse(limitsSchema, { ...LIMITS, ...limits }).success;

describe("the brakes on the endpoint", () => {
  it("are set, and are the lowest values Lambda accepts", () => {
    expect(v.parse(limitsSchema, LIMITS)).toEqual({
      rateLimit: 100,
      maxEnvironments: 2,
      maxConcurrencyPerEnvironment: 64,
      timeoutSeconds: 10,
    });
    expect(accepts({ rateLimit: 50 })).toBe(false);
    expect(accepts({ maxEnvironments: 1 })).toBe(false);
  });

  it("bound the requests in flight at once to 128", () => {
    expect(peakConcurrency(LIMITS)).toBe(128);
  });

  it("take a rate limit only in the documented steps", () => {
    for (const rateLimit of [0, 100, 900, 1000, 2000, 10_000]) {
      expect(accepts({ rateLimit }), String(rateLimit)).toBe(true);
    }
    for (const rateLimit of [-1, 1, 150, 1100, 1500, 2500, 11_000, 100.5]) {
      expect(accepts({ rateLimit }), String(rateLimit)).toBe(false);
    }
  });

  it("refuse a concurrency or a timeout outside the documented range", () => {
    expect(accepts({ maxConcurrencyPerEnvironment: 128, timeoutSeconds: 900 })).toBe(true);
    expect(accepts({ maxConcurrencyPerEnvironment: 0 })).toBe(false);
    expect(accepts({ maxConcurrencyPerEnvironment: 129 })).toBe(false);
    expect(accepts({ timeoutSeconds: 2 })).toBe(false);
    expect(accepts({ timeoutSeconds: 901 })).toBe(false);
    expect(accepts({ maxEnvironments: 10_001 })).toBe(false);
  });
});

describe("a release, read from `-c` flags", () => {
  it("is absent until a package has been uploaded", () => {
    expect(parseRelease(context({}))).toBeUndefined();
  });

  it("sends everything to the one upload named", () => {
    const release = parseRelease(context({ stable: "v1" }));
    expect(release && shares(release)).toEqual([{ version: "v1", weight: 100 }]);
  });

  // #region canary
  it("splits between two uploads, in whole numbers that add up to 100", () => {
    for (const canaryWeight of ["1", "10", "50", "99"]) {
      const release = parseRelease(context({ stable: "v1", canary: "v2", canaryWeight }));
      const split = release === undefined ? [] : shares(release);
      expect(split.map((share) => share.version)).toEqual(["v1", "v2"]);
      expect(split.reduce((sum, share) => sum + share.weight, 0)).toBe(100);
      expect(split.every((share) => Number.isInteger(share.weight) && share.weight >= 1)).toBe(
        true,
      );
    }
  });

  it("rolls back by leaving the canary out: the same flags as before the canary", () => {
    const before = parseRelease(context({ stable: "v1" }));
    const during = parseRelease(context({ stable: "v1", canary: "v2", canaryWeight: "10" }));
    const after = parseRelease(context({ stable: "v1" }));
    expect(during && shares(during)).toHaveLength(2);
    expect(after && shares(after)).toEqual(before && shares(before));
  });
  // #endregion canary

  it("refuses a weight that would leave one side with nothing, or with a fraction", () => {
    for (const canaryWeight of ["0", "100", "-1", "10.5", "ten", ""]) {
      expect(
        () => parseRelease(context({ stable: "v1", canary: "v2", canaryWeight })),
        canaryWeight,
      ).toThrow(/Invalid release/);
    }
  });

  it("refuses half a canary, a canary with nothing stable, and the same upload twice", () => {
    expect(() => parseRelease(context({ stable: "v1", canary: "v2" }))).toThrow(/go together/);
    expect(() => parseRelease(context({ stable: "v1", canaryWeight: "10" }))).toThrow(
      /go together/,
    );
    expect(() => parseRelease(context({ canary: "v2", canaryWeight: "10" }))).toThrow(/stable/);
    expect(() => parseRelease(context({ stable: "v1", canary: "v1", canaryWeight: "10" }))).toThrow(
      /same upload/,
    );
  });

  it("refuses a version ID with a space in it: a paste that went wrong", () => {
    expect(() => parseRelease(context({ stable: "v1 -c canary=v2" }))).toThrow(/Invalid release/);
  });
});
