import { describe, expect, it } from "vite-plus/test";

import {
  cacheControlFor,
  type Exchange,
  NO_STORE,
  SHARED,
  SHARED_SECONDS,
} from "../core/cache-control.ts";
import { isPersonalPath, PERSONAL_PATH_PATTERNS } from "../core/routes.ts";
import {
  type CacheRequest,
  type CacheResponse,
  createSharedCache,
  sharedLifetime,
} from "./support/shared-cache.ts";

const anonymousPage: Exchange = {
  method: "GET",
  path: "/notes/abc",
  status: 200,
  hasCookie: false,
  hasAuthorization: false,
  setsCookie: false,
};

describe("cacheControlFor", () => {
  it("shares an anonymous 200 on a public path, and nothing else", () => {
    expect(cacheControlFor(anonymousPage)).toEqual({ value: SHARED, reason: "public" });

    const variations: [Partial<Exchange>, string][] = [
      [{ method: "POST" }, "method"],
      [{ path: "/__nuxt_error" }, "internal"],
      [{ path: "/me" }, "personal-path"],
      [{ path: "/me/api/viewer" }, "personal-path"],
      [{ hasCookie: true }, "credentials"],
      [{ hasAuthorization: true }, "credentials"],
      [{ setsCookie: true }, "set-cookie"],
      [{ status: 404 }, "status"],
      [{ status: 500 }, "status"],
    ];
    for (const [change, reason] of variations) {
      expect(cacheControlFor({ ...anonymousPage, ...change })).toEqual({ value: NO_STORE, reason });
    }
  });

  it("does not take a look-alike path for a personal one, or the reverse", () => {
    expect(isPersonalPath("/me")).toBe(true);
    expect(isPersonalPath("/me/sign-in")).toBe(true);
    expect(isPersonalPath("/menu")).toBe(false);
    expect(isPersonalPath("/notes/me")).toBe(false);
    expect(PERSONAL_PATH_PATTERNS).toEqual(["/me", "/me/*"]);
  });

  it("writes headers that a shared cache reads the intended way", () => {
    expect(sharedLifetime(SHARED)).toBe(SHARED_SECONDS);
    expect(sharedLifetime(NO_STORE)).toBe(0);
    expect(sharedLifetime(undefined)).toBe(0);
  });
});

// An origin that renders the reader's name into every page it is asked for.
const nameOf = (request: CacheRequest): string =>
  /user=(\w+)/.exec(request.headers["cookie"] ?? "")?.[1] ?? "nobody";

const originWith =
  (label: (exchange: Exchange) => string) =>
  async (request: CacheRequest): Promise<CacheResponse> => ({
    status: 200,
    headers: {
      "cache-control": label({
        method: request.method,
        path: request.path,
        status: 200,
        hasCookie: request.headers["cookie"] !== undefined,
        hasAuthorization: request.headers["authorization"] !== undefined,
        setsCookie: false,
      }),
    },
    body: `page for ${nameOf(request)}`,
  });

const alice = { method: "GET", headers: { cookie: "user=alice" } };
const bob = { method: "GET", headers: {} };

describe("a signed-in page behind a shared cache", () => {
  it("leaks when the origin labels everything public (the failure this chapter is about)", async () => {
    const cache = createSharedCache(
      originWith(() => SHARED),
      () => 0,
    );
    await cache.fetch({ ...alice, path: "/me" });
    const served = await cache.fetch({ ...bob, path: "/me" });
    expect(served).toMatchObject({ from: "cache", body: "page for alice" });
  });

  it("never reaches the next reader with this app's labels, in either order", async () => {
    for (const path of ["/me", "/", "/notes/abc"]) {
      const cache = createSharedCache(
        originWith((exchange) => cacheControlFor(exchange).value),
        () => 0,
      );
      await cache.fetch({ ...alice, path });
      expect((await cache.fetch({ ...bob, path })).body).toBe("page for nobody");
    }
    for (const path of ["/me", "/", "/notes/abc"]) {
      const cache = createSharedCache(
        originWith((exchange) => cacheControlFor(exchange).value),
        () => 0,
      );
      await cache.fetch({ ...bob, path });
      await cache.fetch({ ...alice, path });
      expect((await cache.fetch({ ...bob, path })).body).toBe("page for nobody");
    }
  });

  it("stores only what was rendered without credentials", async () => {
    const cache = createSharedCache(
      originWith((exchange) => cacheControlFor(exchange).value),
      () => 0,
    );
    await cache.fetch({ ...alice, path: "/" });
    expect(cache.storedPaths()).toEqual([]);
    await cache.fetch({ ...bob, path: "/" });
    await cache.fetch({ ...bob, path: "/me" });
    expect(cache.storedPaths()).toEqual(["/"]);
  });

  it("serves a public page for at most the stated staleness", async () => {
    let nowMs = 0;
    let version = 1;
    const cache = createSharedCache(
      async () => ({ status: 200, headers: { "cache-control": SHARED }, body: `v${version}` }),
      () => nowMs,
    );
    await cache.fetch({ ...bob, path: "/" });
    version = 2;

    nowMs = (SHARED_SECONDS - 1) * 1000;
    expect(await cache.fetch({ ...bob, path: "/" })).toMatchObject({ from: "cache", body: "v1" });
    nowMs = SHARED_SECONDS * 1000;
    expect(await cache.fetch({ ...bob, path: "/" })).toMatchObject({ from: "origin", body: "v2" });
  });
});
