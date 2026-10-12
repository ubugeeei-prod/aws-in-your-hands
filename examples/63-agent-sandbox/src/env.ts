import * as v from "valibot";

import {
  isVerifiedProfileId,
  type VerifiedProfileId,
} from "@aih/example-17-ai/infra/lib/models.ts";

const list = v.pipe(
  v.string(),
  v.transform((text) => text.split(",").filter((item) => item !== "")),
);

// #region env
/** What the stack sets on the two functions. Read once, at cold start. */
const functionEnvSchema = v.object({
  CLUSTER_ARN: v.pipe(v.string(), v.startsWith("arn:")),
  TASK_DEFINITION_ARN: v.pipe(v.string(), v.startsWith("arn:")),
  SUBNET_IDS: list,
  SECURITY_GROUP_ID: v.pipe(v.string(), v.minLength(1)),
  MODEL: v.pipe(
    v.string(),
    v.check((id): id is VerifiedProfileId => isVerifiedProfileId(id), "not a verified profile"),
    v.transform((id) => id as VerifiedProfileId),
  ),
  // The launcher's alone. The reaper has no use for either, and its role could not read the secret.
  ALLOWED_REPOSITORIES: v.optional(list, ""),
  GITHUB_APP_SECRET_ARN: v.optional(v.string()),
  EXEC: v.optional(v.picklist(["true", "false"]), "false"),
});
export type FunctionEnv = v.InferOutput<typeof functionEnvSchema>;

export const readFunctionEnv = (source: Record<string, string | undefined>): FunctionEnv =>
  v.parse(functionEnvSchema, source);
// #endregion env
