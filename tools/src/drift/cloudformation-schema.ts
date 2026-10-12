import * as v from "valibot";

// Response shapes of DetectStackDrift, DescribeStackDriftDetectionStatus,
// DescribeStackResourceDrifts and ListStackResources, as typed by
// @aws-sdk/client-cloudformation 3.1149.0. Fields this gate does not use are dropped,
// which also keeps ActualProperties and ExpectedProperties out of the report.

/** The SDK gives a Date; a fixture gives a string. Either must name a real moment. */
const timestamp = v.pipe(
  v.union([v.date(), v.string()]),
  v.transform((value) => new Date(value)),
  v.date(),
);

export const detectStartSchema = v.object({
  StackDriftDetectionId: v.pipe(v.string(), v.minLength(1)),
});

export const detectionStatusSchema = v.object({
  StackId: v.string(),
  StackDriftDetectionId: v.string(),
  DetectionStatus: v.picklist(["DETECTION_IN_PROGRESS", "DETECTION_FAILED", "DETECTION_COMPLETE"]),
  StackDriftStatus: v.optional(v.picklist(["DRIFTED", "IN_SYNC", "UNKNOWN", "NOT_CHECKED"])),
  DetectionStatusReason: v.optional(v.string()),
  DriftedStackResourceCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  /** When the detection was started. */
  Timestamp: timestamp,
});

export const resourceDriftSchema = v.object({
  LogicalResourceId: v.string(),
  ResourceType: v.string(),
  StackResourceDriftStatus: v.picklist([
    "IN_SYNC",
    "MODIFIED",
    "DELETED",
    "NOT_CHECKED",
    "UNKNOWN",
    "UNSUPPORTED",
  ]),
  PropertyDifferences: v.optional(
    v.array(
      v.object({
        PropertyPath: v.string(),
        DifferenceType: v.picklist(["ADD", "REMOVE", "NOT_EQUAL"]),
      }),
    ),
  ),
  DriftStatusReason: v.optional(v.string()),
  /** When this resource was last checked, which may be before the detection just run. */
  Timestamp: timestamp,
});

export const resourceDriftPageSchema = v.object({
  StackResourceDrifts: v.array(resourceDriftSchema),
  NextToken: v.optional(v.string()),
});

export const stackResourceSchema = v.object({
  LogicalResourceId: v.string(),
  ResourceType: v.string(),
  ResourceStatus: v.string(),
});

export const stackResourcePageSchema = v.object({
  StackResourceSummaries: v.optional(v.array(stackResourceSchema), []),
  NextToken: v.optional(v.string()),
});

export type DetectionStatus = v.InferOutput<typeof detectionStatusSchema>;
export type ResourceDrift = v.InferOutput<typeof resourceDriftSchema>;
export type StackResource = v.InferOutput<typeof stackResourceSchema>;
