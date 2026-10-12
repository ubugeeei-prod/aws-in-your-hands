import { describe, expect, it } from "vite-plus/test";

import { withSharedCache } from "../src/cache.ts";
import { composeApp } from "../src/compose.ts";
import { SHARED_CACHE } from "../src/defences.ts";

const app = composeApp({ ALLOWED_ORIGIN: "https://d111.cloudfront.net", LOG_LEVEL: "error" });
const get = (path: string, init?: RequestInit) => app(new Request(`https://api.test${path}`, init));

describe("what CloudFront is told it may keep", () => {
  it("lets the route that is the same for everyone be reused for a few seconds", async () => {
    const response = await get("/health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      `public, max-age=${SHARED_CACHE.maxAgeSeconds}`,
    );
  });

  it("says the same whatever the query string, which the cache key leaves out", async () => {
    const response = await get("/health?x=1");
    expect(response.headers.get("cache-control")).toContain("public");
  });

  it("keeps notes out of every cache", async () => {
    for (const path of ["/notes", "/notes/abc", "/health/extra"]) {
      const response = await get(path);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
    }
  });

  it("does not let an error or a write be stored", async () => {
    const failing = withSharedCache(() => new Response(null, { status: 503 }), SHARED_CACHE);
    const down = await failing(new Request("https://api.test/health"));
    expect(down.headers.get("cache-control")).toBe("no-store");

    const posted = await get("/health", { method: "POST" });
    expect(posted.headers.get("cache-control")).toBe("no-store");
  });
});
