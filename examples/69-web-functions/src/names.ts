import type { Limits } from "./release.ts";

// What the stack creates and what the scripts look for, spelled once.

export const STACK = "AihWebFunctions";
export const FUNCTION_NAME = "aih-web-notes";
export const ENDPOINT_NAME = "notes";
export const CODE_PREFIX = "notes";
export const CODE_KEY = `${CODE_PREFIX}/function.zip`;
/** Lambda adds a second group, this name followed by ".local", for the Region the request ran in. */
export const LOG_GROUP = "/aih/web-notes";
/** Where `cdk deploy` writes the stack outputs, relative to this example. */
export const OUTPUTS_FILE = "reports/webfn-outputs.json";

/** Bucket names are global. The account and Region make this one yours. */
export const codeBucketName = (accountId: string, region: string): string =>
  `aih-web-notes-code-${accountId}-${region}`;

// #region limits
// The brakes of a practice stack: the lowest values an endpoint accepts.
// At most 2 x 64 = 128 requests in flight, and 100 arriving per second.
export const LIMITS: Limits = {
  rateLimit: 100,
  maxEnvironments: 2,
  maxConcurrencyPerEnvironment: 64,
  // Chapter 04's value. The default is 30 seconds, and a revision copies nothing from the one before.
  timeoutSeconds: 10,
};
// #endregion limits
