import { z } from "zod";

// #region config
// Read from /config.json at start-up, so one build fits any deployment.
// Nothing in it is secret: a public client's settings are visible to anyone.
const configSchema = z.object({
  apiUrl: z.url({ protocol: /^https?$/ }),
  auth: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("local") }),
    z.object({
      mode: z.literal("cognito"),
      /** https://cognito-idp.<region>.amazonaws.com/<user pool ID> */
      issuer: z.url({ protocol: /^https$/ }),
      /** https://<prefix>.auth.<region>.amazoncognito.com */
      domain: z.url({ protocol: /^https$/ }),
      clientId: z.string().min(1),
    }),
  ]),
});

export type AppConfig = z.infer<typeof configSchema>;

export function parseConfig(json: unknown): AppConfig {
  return configSchema.parse(json);
}
// #endregion config

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<AppConfig> {
  const response = await fetchImpl("/config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`/config.json answered ${response.status}`);
  }
  return parseConfig(await response.json());
}
