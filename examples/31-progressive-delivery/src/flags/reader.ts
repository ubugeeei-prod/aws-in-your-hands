import { readFile } from "node:fs/promises";

import * as v from "valibot";

import { parseDocument, toRetrieved } from "./document.ts";
import { defaultFlags, type Flags, flagsSchema, knownFlags } from "./evaluate.ts";

// #region reader
/** Where the flags of one request came from. */
export type FlagOrigin = "live" | "last-known" | "defaults";

export type FlagReading = { flags: Flags; origin: FlagOrigin };

export type FlagSource = () => Promise<unknown>;

/**
 * Reads the flags for one request, and always answers. When the source fails or says
 * something this build cannot read, the last good answer is used, however old. Before
 * there has been one, the defaults in the code are.
 */
export function createFlagReader(
  source: FlagSource,
  report: (origin: FlagOrigin, error: unknown) => void,
): () => Promise<FlagReading> {
  let lastKnown: Flags | undefined;
  let lastOrigin: FlagOrigin = "live";
  return async () => {
    let reading: FlagReading;
    let failure: unknown;
    try {
      lastKnown = v.parse(flagsSchema, await source());
      reading = { flags: lastKnown, origin: "live" };
    } catch (error) {
      failure = error;
      reading =
        lastKnown === undefined
          ? { flags: defaultFlags, origin: "defaults" }
          : { flags: lastKnown, origin: "last-known" };
    }
    // Once per change, not once per request: an outage must not also flood the log.
    if (reading.origin !== lastOrigin) {
      report(reading.origin, failure);
      lastOrigin = reading.origin;
    }
    return reading;
  };
}
// #endregion reader

// #region extension
export type ExtensionSettings = {
  /** The port the AppConfig Agent extension listens on inside the execution environment. */
  port: number;
  application: string;
  environment: string;
  profile: string;
  timeoutMs: number;
};

/** Asks the extension next to the function. It answers from its own cache and refreshes that in the background. */
export function extensionSource(settings: ExtensionSettings, fetchFlags: typeof fetch): FlagSource {
  const path = [
    "applications",
    settings.application,
    "environments",
    settings.environment,
    "configurations",
    settings.profile,
  ]
    .map(encodeURIComponent)
    .join("/");
  return async () => {
    const response = await fetchFlags(`http://localhost:${settings.port}/${path}`, {
      // The request must not wait on flags for longer than it could afford to fail.
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`The AppConfig extension answered ${response.status}.`);
    }
    return response.json();
  };
}
// #endregion extension

// #region file
/** For the laptop: the same document that is deployed to AppConfig, read from disk on every request. */
export function fileSource(path: string): FlagSource {
  return async () => toRetrieved(parseDocument(await readFile(path, "utf8"), knownFlags));
}
// #endregion file
