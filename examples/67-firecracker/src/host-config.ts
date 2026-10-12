import * as v from "valibot";

export const REGION = "ap-northeast-1";
export const HOST_STACK = "AihFirecracker";
export const KIT_PREFIX = "kit/";
export const KIT_FILE = "kit.tgz";

// #region schema
/** Intel types the EC2 guide lists for nested virtualization, with a price in data/pricing. */
export const INSTANCE_TYPES = ["c7i.large", "c8i.large"] as const;

// `-c run=true` arrives as a string, cdk.json would give a boolean.
const flag = v.pipe(
  v.union([v.boolean(), v.picklist(["true", "false"])]),
  v.transform((value) => value === true || value === "true"),
);

export const hostConfigSchema = v.object({
  // Off: the stack holds only what costs nothing. On: one instance, billed by the hour.
  run: v.optional(flag, false),
  instanceType: v.optional(v.picklist(INSTANCE_TYPES), "c7i.large"),
  // Room for the kernel, the rootfs image and Node.js twice.
  rootVolumeGiB: v.optional(
    v.pipe(
      v.union([v.number(), v.string()]),
      v.transform(Number),
      v.integer(),
      v.minValue(8),
      v.maxValue(64),
    ),
    16,
  ),
});
export type HostConfig = v.InferOutput<typeof hostConfigSchema>;
// #endregion schema

export function parseHostConfig(input: unknown): HostConfig {
  const result = v.safeParse(hostConfigSchema, input);
  if (!result.success) {
    const lines = result.issues.map(
      (issue) => `  ${v.getDotPath(issue) ?? "(settings)"}: ${issue.message}`,
    );
    throw new Error(`Invalid host settings\n${lines.join("\n")}`);
  }
  return result.output;
}
