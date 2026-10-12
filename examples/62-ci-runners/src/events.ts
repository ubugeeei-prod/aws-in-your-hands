import * as v from "valibot";

const id = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

// #region delivery
/**
 * The part of a `workflow_job` delivery the receiver reads, after GitHub's webhook schema.
 * Unknown keys are dropped: the payload has a hundred more.
 */
export const workflowJobSchema = v.object({
  action: v.picklist(["queued", "in_progress", "completed", "waiting"]),
  repository: v.object({
    full_name: v.pipe(v.string(), v.minLength(3), v.maxLength(200)),
    private: v.boolean(),
  }),
  /** Present when the delivery is for a GitHub App. Without it there is no token to ask for. */
  installation: v.optional(v.object({ id })),
  workflow_job: v.object({
    id,
    run_id: id,
    run_attempt: id,
    labels: v.pipe(v.array(v.pipe(v.string(), v.maxLength(256))), v.maxLength(100)),
  }),
});
export type WorkflowJobDelivery = v.InferOutput<typeof workflowJobSchema>;
// #endregion delivery

// #region run
/** The part of "Get a workflow run" that says where the code came from. */
export const workflowRunSchema = v.object({
  event: v.string(),
  repository: v.object({ full_name: v.string() }),
  /** Null is not in GitHub's schema. It is accepted here so that it can be refused by name. */
  head_repository: v.nullable(v.object({ full_name: v.string() })),
});
export type WorkflowRun = v.InferOutput<typeof workflowRunSchema>;
// #endregion run
