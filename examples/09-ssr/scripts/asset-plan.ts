// Pure, so the order and the retention rule are testable without AWS.

import {
  contentTypeFor,
  IMMUTABLE,
  type LocalFile,
  type RemoteObject,
  REVALIDATE,
  type Upload,
} from "@aih/tools/site/plan.ts";

// #region plan
/** Nuxt rewrites this one file on every build to say which build is current. */
const BUILD_POINTER = "_nuxt/builds/latest.json";
const DAY_MS = 24 * 60 * 60 * 1000;

export type AssetPlan = {
  /** New content-hashed files. Adding them cannot break a page that is already out. */
  upload: Upload[];
  /** The build pointer, once the files it points at exist. */
  uploadLast: Upload[];
  /** Files of older builds, past the retention period. */
  remove: string[];
  unchanged: number;
  retained: number;
};

export function planAssets(input: {
  local: LocalFile[];
  remote: RemoteObject[];
  now: Date;
  /** How long files of older builds stay, for HTML that is still cached or still open in a tab. */
  retentionDays: number;
}): AssetPlan {
  const stray = input.local.filter((file) => !file.key.startsWith("_nuxt/"));
  if (input.local.length === 0 || stray.length > 0) {
    // CloudFront sends only /_nuxt/* to the bucket. Anything else would be uploaded and never served.
    throw new Error(
      stray.length > 0
        ? `Only _nuxt/ is served from the bucket, but the build also has: ${stray.map((file) => file.key).join(", ")}`
        : "The build output has no files. Refusing to plan a publish from it.",
    );
  }

  const remoteByKey = new Map(input.remote.map((object) => [object.key, object]));
  const localKeys = new Set(input.local.map((file) => file.key));
  const toUpload = (key: string, cacheControl: string): Upload => ({
    key,
    contentType: contentTypeFor(key),
    cacheControl,
  });

  const hashed = input.local.filter((file) => file.key !== BUILD_POINTER);
  // A hashed name never changes content, so an existing object is left alone.
  const upload = hashed
    .filter((file) => !remoteByKey.has(file.key))
    .map((file) => toUpload(file.key, IMMUTABLE));
  const pointer = input.local.find((file) => file.key === BUILD_POINTER);
  const pointerChanged =
    pointer !== undefined &&
    remoteByKey.get(BUILD_POINTER)?.etag.replaceAll('"', "") !== pointer.md5;

  const orphans = input.remote.filter((object) => !localKeys.has(object.key));
  const remove = orphans
    .filter(
      (object) =>
        input.now.getTime() - object.lastModified.getTime() > input.retentionDays * DAY_MS,
    )
    .map((object) => object.key);

  return {
    upload: upload.toSorted((a, b) => a.key.localeCompare(b.key)),
    uploadLast: pointerChanged ? [toUpload(BUILD_POINTER, REVALIDATE)] : [],
    remove: remove.toSorted(),
    unchanged: input.local.length - upload.length - (pointerChanged ? 1 : 0),
    retained: orphans.length - remove.length,
  };
}
// #endregion plan

export const describeAssetPlan = (plan: AssetPlan): string =>
  [
    `upload new assets:    ${plan.upload.length}`,
    `update build pointer: ${plan.uploadLast.length}`,
    `unchanged:            ${plan.unchanged}`,
    `delete old assets:    ${plan.remove.length}`,
    `old assets retained:  ${plan.retained}`,
  ].join("\n");
