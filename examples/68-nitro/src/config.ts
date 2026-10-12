import * as v from "valibot";

import { isMeasurement } from "./measurement.ts";

export const REGION = "ap-northeast-1";
export const NITRO_STACK = "AihNitro";

// #region options
/**
 * Graviton types with two vCPUs that the Nitro Enclaves requirements list, and with a
 * price in data/pricing/unit-prices.json. The T4g of chapter 23 is not on that list.
 */
export const INSTANCE_TYPES = ["c6g.large", "m6g.large"] as const;
export type InstanceType = (typeof INSTANCE_TYPES)[number];
// #endregion options

// #region schema
export const nitroConfigSchema = v.object({
  instanceType: v.optional(v.picklist(INSTANCE_TYPES), "c6g.large"),
  // PCR0 of the enclave image, as `nitro-cli build-enclave` prints it. No default:
  // until an image is named, the key policy lets nobody use the key.
  measurement: v.optional(
    v.pipe(
      v.string(),
      v.transform((value) => value.toLowerCase()),
      v.check(isMeasurement, "96 hexadecimal characters (a SHA-384 digest), and not all zeros"),
    ),
  ),
  // Unset: the latest Amazon Linux 2023, looked up at deploy time.
  amiId: v.optional(v.pipe(v.string(), v.regex(/^ami-[0-9a-f]{8,17}$/))),
});

export type NitroConfig = v.InferOutput<typeof nitroConfigSchema>;
// #endregion schema

/** Parses settings from CDK context or the command line; the message names every bad field. */
export function parseNitroConfig(input: unknown): NitroConfig {
  const result = v.safeParse(nitroConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid Nitro settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
