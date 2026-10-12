import { isInternalPath, isPersonalPath } from "./routes.ts";

// #region values
export const NO_STORE = "private, no-store";

/** How long a shared cache may keep a public page. This is the staleness the app accepts. */
export const SHARED_SECONDS = 60;

// max-age=0: the browser asks again every time. s-maxage: the shared cache may answer for it.
export const SHARED = `public, max-age=0, s-maxage=${SHARED_SECONDS}`;
// #endregion values

// #region decide
export type Exchange = {
  method: string;
  path: string;
  status: number;
  /** The request carried a Cookie header, whatever is in it. */
  hasCookie: boolean;
  hasAuthorization: boolean;
  /** The response sets a cookie. A shared cache would replay it to everyone. */
  setsCookie: boolean;
};

export type CacheDecision = {
  value: typeof NO_STORE | typeof SHARED;
  reason:
    | "method"
    | "internal"
    | "personal-path"
    | "credentials"
    | "set-cookie"
    | "status"
    | "public";
};

export function cacheControlFor(exchange: Exchange): CacheDecision {
  const method = exchange.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return { value: NO_STORE, reason: "method" };
  }
  if (isInternalPath(exchange.path)) {
    return { value: NO_STORE, reason: "internal" };
  }
  if (isPersonalPath(exchange.path)) {
    return { value: NO_STORE, reason: "personal-path" };
  }
  // The handler could have used them, so the response may be about one person.
  if (exchange.hasCookie || exchange.hasAuthorization) {
    return { value: NO_STORE, reason: "credentials" };
  }
  if (exchange.setsCookie) {
    return { value: NO_STORE, reason: "set-cookie" };
  }
  if (exchange.status !== 200) {
    return { value: NO_STORE, reason: "status" };
  }
  return { value: SHARED, reason: "public" };
}
// #endregion decide
