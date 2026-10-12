import * as v from "valibot";

import { REGIONS } from "./regions.ts";

// #region env
// What this chapter adds to chapter 05's environment. The rest is parsed there.
const regionalEnvSchema = v.object({
  // Set by the stack, not read from the runtime: the value is then the one the template shows.
  REGION: v.picklist(REGIONS),
  WRITES: v.optional(v.picklist(["accept", "refuse"]), "accept"),
  // "fail" is for a failover drill: Route 53 is told this Region is down while it is not.
  HEALTH: v.optional(v.picklist(["probe", "fail"]), "probe"),
});

export type RegionalEnv = v.InferOutput<typeof regionalEnvSchema>;

export function parseRegionalEnv(source: Record<string, string | undefined>): RegionalEnv {
  const result = v.safeParse(regionalEnvSchema, source);
  if (!result.success) {
    const problems = result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
    throw new Error(`Invalid environment:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
// #endregion env
