// Decides what a publish does, without doing it. Everything here is a pure
// function of the local build and a listing of the bucket, so the order and
// the cache headers can be tested without AWS.

export type LocalFile = { key: string; md5: string; size: number };
export type RemoteObject = { key: string; etag: string; lastModified: Date };

export type Upload = { key: string; contentType: string; cacheControl: string };

export type PublishPlan = {
  /** Phase 1: files with a content hash in their name. Safe to add at any time. */
  uploadAssets: Upload[];
  /** Phase 2: HTML and other mutable files. These start referring to phase 1. */
  uploadPages: Upload[];
  /** Phase 3: pages that no longer exist in the build. */
  deletePages: string[];
  /** Phase 4: hashed files that no build has referenced for the retention period. */
  deleteAssets: string[];
  unchanged: number;
  retainedAssets: number;
};

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  webmanifest: "application/manifest+json; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  wasm: "application/wasm",
};

export function contentTypeFor(key: string): string {
  const extension = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1).toLowerCase() : "";
  const contentType = CONTENT_TYPES[extension];
  if (contentType === undefined) {
    // S3 would store application/octet-stream and browsers would download the
    // file instead of rendering it. Fail here rather than publish that.
    throw new Error(
      `No content type is defined for "${key}". Add its extension to CONTENT_TYPES in tools/src/site/plan.ts.`,
    );
  }
  return contentType;
}

// #region cache
/**
 * Ox Content and Vite both write content-hashed files under assets/. Their
 * name changes whenever their bytes change, so a cached copy is never stale.
 */
export const isHashedAsset = (key: string): boolean => key.startsWith("assets/");

/** One year, and never revalidated: the URL itself changes when the content does. */
export const IMMUTABLE = "public, max-age=31536000, immutable";
/**
 * Cacheable, but checked with the origin before each reuse. CloudFront turns
 * that check into a conditional request to S3, so a publish becomes visible
 * without an invalidation.
 */
export const REVALIDATE = "public, max-age=0, must-revalidate";

export const cacheControlFor = (key: string): string => (isHashedAsset(key) ? IMMUTABLE : REVALIDATE);
// #endregion cache

const normalizeEtag = (etag: string): string => etag.replaceAll('"', "");

const DAY_MS = 24 * 60 * 60 * 1000;

export function planPublish(input: {
  local: LocalFile[];
  remote: RemoteObject[];
  now: Date;
  /** Hashed assets missing from this build are kept this long for readers who still hold an older page. */
  assetRetentionDays: number;
  /** Upload every file even when its bytes are unchanged, to rewrite headers. */
  force: boolean;
}): PublishPlan {
  if (!input.local.some((file) => file.key === "index.html")) {
    // An empty or wrong directory would otherwise plan the deletion of every page.
    throw new Error("The build output has no index.html. Refusing to plan a publish from it.");
  }

  const remoteByKey = new Map(input.remote.map((object) => [object.key, object]));
  const localKeys = new Set(input.local.map((file) => file.key));

  const uploads = input.local
    .filter((file) => input.force || normalizeEtag(remoteByKey.get(file.key)?.etag ?? "") !== file.md5)
    .map((file) => ({ key: file.key, contentType: contentTypeFor(file.key), cacheControl: cacheControlFor(file.key) }))
    .toSorted((a, b) => a.key.localeCompare(b.key));

  const orphans = input.remote.filter((object) => !localKeys.has(object.key));
  const expired = (object: RemoteObject): boolean =>
    input.now.getTime() - object.lastModified.getTime() > input.assetRetentionDays * DAY_MS;
  const orphanAssets = orphans.filter((object) => isHashedAsset(object.key));
  const deleteAssets = orphanAssets.filter(expired).map((object) => object.key);

  return {
    uploadAssets: uploads.filter((upload) => isHashedAsset(upload.key)),
    uploadPages: uploads.filter((upload) => !isHashedAsset(upload.key)),
    deletePages: orphans
      .filter((object) => !isHashedAsset(object.key))
      .map((object) => object.key)
      .toSorted(),
    deleteAssets: deleteAssets.toSorted(),
    unchanged: input.local.length - uploads.length,
    retainedAssets: orphanAssets.length - deleteAssets.length,
  };
}

export function describePlan(plan: PublishPlan): string {
  return [
    `upload hashed assets: ${plan.uploadAssets.length}`,
    `upload pages:         ${plan.uploadPages.length}`,
    `unchanged:            ${plan.unchanged}`,
    `delete stale pages:   ${plan.deletePages.length}`,
    `delete old assets:    ${plan.deleteAssets.length}`,
    `old assets retained:  ${plan.retainedAssets}`,
  ].join("\n");
}
