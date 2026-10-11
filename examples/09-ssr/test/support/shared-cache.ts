// A deliberately naive shared cache: the worst CDN configuration the app could
// sit behind. It keys on the path alone, forwards every header to the origin,
// and stores whatever the origin allows, Set-Cookie included.
export type CacheRequest = { method: string; path: string; headers: Record<string, string> };
export type CacheResponse = { status: number; headers: Record<string, string>; body: string };
export type Origin = (request: CacheRequest) => Promise<CacheResponse>;

export type Served = CacheResponse & { from: "cache" | "origin" };

/** Seconds a shared cache may keep the response, by its Cache-Control header alone. */
export function sharedLifetime(cacheControl: string | undefined): number {
  const directives = new Map(
    (cacheControl ?? "")
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part !== "")
      .map((part): [string, string] => {
        const [name = "", value = ""] = part.split("=");
        return [name, value];
      }),
  );
  if (directives.has("private") || directives.has("no-store") || directives.has("no-cache")) {
    return 0;
  }
  const seconds = Number(directives.get("s-maxage") ?? directives.get("max-age") ?? "0");
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function createSharedCache(origin: Origin, now: () => number) {
  const stored = new Map<string, { response: CacheResponse; expiresAt: number }>();
  return {
    storedPaths: (): string[] => [...stored.keys()].toSorted(),
    async fetch(request: CacheRequest): Promise<Served> {
      const cacheable = request.method === "GET";
      const hit = cacheable ? stored.get(request.path) : undefined;
      if (hit !== undefined && hit.expiresAt > now()) {
        return { ...hit.response, from: "cache" };
      }
      const response = await origin(request);
      const lifetime = sharedLifetime(response.headers["cache-control"]);
      if (cacheable && response.status === 200 && lifetime > 0) {
        stored.set(request.path, { response, expiresAt: now() + lifetime * 1000 });
      }
      return { ...response, from: "origin" };
    },
  };
}
