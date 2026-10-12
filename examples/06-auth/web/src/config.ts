import * as v from "valibot";

// #region config
// Read from /config.json at start-up, so one build fits any deployment.
// Nothing in it is secret: a public client's settings are visible to anyone.
// A URL, and one of the named schemes. "javascript:" is a URL too.
const url = (...protocols: string[]) =>
  v.pipe(
    v.string(),
    v.url(),
    v.check((value) => protocols.includes(new URL(value).protocol), "unexpected URL scheme"),
  );

const configSchema = v.object({
  apiUrl: url("http:", "https:"),
  auth: v.variant("mode", [
    v.object({ mode: v.literal("local") }),
    v.object({
      mode: v.literal("cognito"),
      /** https://cognito-idp.<region>.amazonaws.com/<user pool ID> */
      issuer: url("https:"),
      /** https://<prefix>.auth.<region>.amazoncognito.com */
      domain: url("https:"),
      clientId: v.pipe(v.string(), v.minLength(1)),
    }),
  ]),
});

export type AppConfig = v.InferOutput<typeof configSchema>;

export function parseConfig(json: unknown): AppConfig {
  return v.parse(configSchema, json);
}
// #endregion config

export async function loadConfig(fetchImpl: typeof fetch = fetch): Promise<AppConfig> {
  const response = await fetchImpl("/config.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`/config.json answered ${response.status}`);
  }
  return parseConfig(await response.json());
}
