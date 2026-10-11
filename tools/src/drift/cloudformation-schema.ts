import { z } from "zod";

// Response shapes of DetectStackDrift, DescribeStackDriftDetectionStatus,
// DescribeStackResourceDrifts and ListStackResources, as typed by
// @aws-sdk/client-cloudformation 3.1149.0. Fields this gate does not use are dropped,
// which also keeps ActualProperties and ExpectedProperties out of the report.

export const detectStartSchema = z.object({ StackDriftDetectionId: z.string().min(1) });

export const detectionStatusSchema = z.object({
  StackId: z.string(),
  StackDriftDetectionId: z.string(),
  DetectionStatus: z.enum(["DETECTION_IN_PROGRESS", "DETECTION_FAILED", "DETECTION_COMPLETE"]),
  StackDriftStatus: z.enum(["DRIFTED", "IN_SYNC", "UNKNOWN", "NOT_CHECKED"]).optional(),
  DetectionStatusReason: z.string().optional(),
  DriftedStackResourceCount: z.number().int().nonnegative().optional(),
  /** When the detection was started. The SDK gives a Date; a fixture gives a string. */
  Timestamp: z.coerce.date(),
});

export const resourceDriftSchema = z.object({
  LogicalResourceId: z.string(),
  ResourceType: z.string(),
  StackResourceDriftStatus: z.enum(["IN_SYNC", "MODIFIED", "DELETED", "NOT_CHECKED", "UNKNOWN", "UNSUPPORTED"]),
  PropertyDifferences: z
    .array(z.object({ PropertyPath: z.string(), DifferenceType: z.enum(["ADD", "REMOVE", "NOT_EQUAL"]) }))
    .optional(),
  DriftStatusReason: z.string().optional(),
  /** When this resource was last checked, which may be before the detection just run. */
  Timestamp: z.coerce.date(),
});

export const resourceDriftPageSchema = z.object({
  StackResourceDrifts: z.array(resourceDriftSchema),
  NextToken: z.string().optional(),
});

export const stackResourceSchema = z.object({
  LogicalResourceId: z.string(),
  ResourceType: z.string(),
  ResourceStatus: z.string(),
});

export const stackResourcePageSchema = z.object({
  StackResourceSummaries: z.array(stackResourceSchema).default([]),
  NextToken: z.string().optional(),
});

export type DetectionStatus = z.infer<typeof detectionStatusSchema>;
export type ResourceDrift = z.infer<typeof resourceDriftSchema>;
export type StackResource = z.infer<typeof stackResourceSchema>;
