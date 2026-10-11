// #region routes
// Everything that may depend on who is asking lives under /me, and nothing else does.
export const isPersonalPath = (path: string): boolean => path === "/me" || path.startsWith("/me/");

// The same boundary as CloudFront path patterns. The stack reads these, so the two cannot drift apart.
export const PERSONAL_PATH_PATTERNS = ["/me", "/me/*"] as const;

// Nuxt renders its error page by calling /__nuxt_error inside the server, and
// copies that inner response's headers onto the real one.
export const isInternalPath = (path: string): boolean => path.startsWith("/__");

// Content-hashed files that Nuxt writes to .output/public/_nuxt.
export const ASSET_PATH_PATTERN = "/_nuxt/*";
// #endregion routes
