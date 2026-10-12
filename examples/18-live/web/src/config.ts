import * as v from "valibot";

// #region config
// Read from /config.json at start-up, so one build fits any channel. The
// playback URL is not a secret, but it does contain the AWS account ID.
const configSchema = v.object({
  /** null until a channel has been deployed and `vp run stream:config` has run. */
  playbackUrl: v.nullable(v.pipe(v.string(), v.url(), v.startsWith("https://"))),
});

export type PlayerPageConfig = v.InferOutput<typeof configSchema>;

export function parseConfig(json: unknown): PlayerPageConfig {
  return v.parse(configSchema, json);
}
// #endregion config

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<PlayerPageConfig> {
  const response = await fetchImpl("/config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`/config.json answered ${response.status}`);
  }
  return parseConfig(await response.json());
}
