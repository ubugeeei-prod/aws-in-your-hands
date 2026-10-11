import { z } from "zod";

// #region config
// Read from /config.json at start-up, so one build fits any channel. The
// playback URL is not a secret, but it does contain the AWS account ID.
const configSchema = z.object({
  /** null until a channel has been deployed and `vp run stream:config` has run. */
  playbackUrl: z.url({ protocol: /^https$/ }).nullable(),
});

export type PlayerPageConfig = z.infer<typeof configSchema>;

export function parseConfig(json: unknown): PlayerPageConfig {
  return configSchema.parse(json);
}
// #endregion config

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<PlayerPageConfig> {
  const response = await fetchImpl("/config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`/config.json answered ${response.status}`);
  }
  return parseConfig(await response.json());
}
