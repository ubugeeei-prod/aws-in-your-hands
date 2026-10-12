import * as v from "valibot";

const present = v.pipe(v.string(), v.minLength(1));
const list = v.pipe(
  v.string(),
  v.transform((value) => value.split(",").filter((item) => item !== "")),
);

// #region receiver-env
export const receiverEnvSchema = v.object({
  WEBHOOK_SECRET_ID: present,
  APP_KEY_SECRET_ID: present,
  /** Empty until the GitHub App exists. The receiver then refuses to start a launch. */
  APP_CLIENT_ID: v.optional(v.string(), ""),
  RUNNER_GROUP_ID: v.pipe(present, v.transform(Number), v.safeInteger(), v.minValue(1)),
  REPOSITORIES: v.optional(list, ""),
  CLAIMS_TABLE: present,
  CLUSTER: present,
  TASK_DEFINITION: present,
  SUBNETS: v.pipe(list, v.minLength(1)),
  SECURITY_GROUP: present,
});
export type ReceiverEnv = v.InferOutput<typeof receiverEnvSchema>;
// #endregion receiver-env

export const sweeperEnvSchema = v.object({ CLUSTER: present });
