import * as v from "valibot";

export const REGION = "ap-northeast-1";
export const MANAGED_INSTANCES_STACK = "AihManagedInstances";

// #region options
/** The two instance types this chapter looked up prices for. Both are arm64 with 2 vCPUs and 8 GiB. */
export const INSTANCE_TYPES = ["m6g.large", "m7g.large"] as const;
export type InstanceType = (typeof INSTANCE_TYPES)[number];

export const VCPUS_PER_INSTANCE = 2;

/** The smallest function Managed Instances accepts: 2 GB of memory, which is 1 vCPU at 2 GiB per vCPU. */
export const FUNCTION_MEMORY_MB = 2048;
// #endregion options

// #region schema
// A number in cdk.json, a string after `-c maxVCpuCount=16`.
const numeric = v.pipe(v.union([v.number(), v.string()]), v.transform(Number), v.number());
const environments = v.pipe(numeric, v.integer(), v.minValue(0), v.maxValue(15_000));

export const managedConfigSchema = v.pipe(
  v.object({
    // v.url() alone would accept "localhost:5173" (scheme "localhost").
    allowedOrigin: v.optional(
      v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//, "Must be an http or https URL.")),
      "http://localhost:5173",
    ),
    instanceType: v.optional(v.picklist(INSTANCE_TYPES), "m6g.large"),
    // Lambda's own default is 3, spread over the zones of the capacity provider.
    minExecutionEnvironments: v.optional(environments, 3),
    maxExecutionEnvironments: v.optional(environments, 6),
    // The ceiling on what the capacity provider may launch. 12 is the lowest value CDK accepts.
    maxVCpuCount: v.optional(v.pipe(numeric, v.integer(), v.minValue(12), v.maxValue(15_000)), 12),
  }),
  v.check(
    (config) => config.minExecutionEnvironments <= config.maxExecutionEnvironments,
    "minExecutionEnvironments must not exceed maxExecutionEnvironments.",
  ),
  // Zero and zero switches the function off. Zero with a maximum above it is not a valid setting.
  v.check(
    (config) => config.minExecutionEnvironments > 0 || config.maxExecutionEnvironments === 0,
    "minExecutionEnvironments may be 0 only when maxExecutionEnvironments is 0 too.",
  ),
);

export type ManagedConfig = v.InferOutput<typeof managedConfigSchema>;
// #endregion schema

/** Parses settings from CDK context or the command line; the message names every bad field. */
export function parseManagedConfig(input: unknown): ManagedConfig {
  const result = v.safeParse(managedConfigSchema, input);
  if (!result.success) {
    const problems = result.issues.map(
      (item) => `  ${v.getDotPath(item) ?? "(root)"}: ${item.message}`,
    );
    throw new Error(`Invalid Managed Instances settings:\n${problems.join("\n")}`);
  }
  return result.output;
}
