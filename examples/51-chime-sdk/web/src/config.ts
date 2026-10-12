import * as v from "valibot";

import { type AppConfig, parseConfig } from "@aih/example-06-auth/web/src/config.ts";

// #region config
// Chapter 06's /config.json with one more key. "none" means the API behind `apiUrl` hands out
// seats in a fake meeting, so the page must not try to connect anywhere.
const mediaSchema = v.object({ media: v.picklist(["none", "chime"]) });

export type CallsConfig = AppConfig & v.InferOutput<typeof mediaSchema>;

export function parseCallsConfig(json: unknown): CallsConfig {
  return { ...parseConfig(json), ...v.parse(mediaSchema, json) };
}
// #endregion config

export async function loadCallsConfig(fetchImpl: typeof fetch = fetch): Promise<CallsConfig> {
  const response = await fetchImpl("/config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`/config.json answered ${response.status}`);
  }
  return parseCallsConfig(await response.json());
}
