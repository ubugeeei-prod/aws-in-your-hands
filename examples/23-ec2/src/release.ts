import { createHash } from "node:crypto";

import * as v from "valibot";

export const RELEASE_PREFIX = "releases/";
export const RELEASE_FILE = "server.mjs";

// #region version
/** Written once, read by both bash (`[[ =~ ]]`) and JavaScript, so the two cannot drift apart. */
export const VERSION_SHELL_PATTERN = "^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$";
export const versionSchema = v.pipe(
  v.string(),
  v.regex(new RegExp(VERSION_SHELL_PATTERN), "not a release version"),
);

/** When it was built, and the first 16 hex digits of what was built. */
export function releaseVersion(bundle: Uint8Array, builtAt: Date): string {
  const stamp = builtAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(/[-:]/g, "");
  const digest = createHash("sha256").update(bundle).digest("hex").slice(0, 16);
  return v.parse(versionSchema, `${stamp}-${digest}`);
}

export const releaseKey = (version: string): string =>
  `${RELEASE_PREFIX}${v.parse(versionSchema, version)}/${RELEASE_FILE}`;
// #endregion version
