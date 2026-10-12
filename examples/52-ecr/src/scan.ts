import * as v from "valibot";

import { digestSchema } from "./reference.ts";

// #region report
/** Lowest to highest. UNDEFINED is not on the scale: the scanner could not rate the finding. */
export const SEVERITIES = ["INFORMATIONAL", "LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type Severity = (typeof SEVERITIES)[number];

const count = v.pipe(v.number(), v.integer(), v.minValue(0));

/** The part of a DescribeImageScanFindings response the decision needs. */
export const scanReportSchema = v.object({
  imageId: v.object({ imageDigest: digestSchema }),
  imageScanStatus: v.object({
    status: v.picklist([
      "IN_PROGRESS",
      "COMPLETE",
      "FAILED",
      "UNSUPPORTED_IMAGE",
      "ACTIVE",
      "PENDING",
      "SCAN_ELIGIBILITY_EXPIRED",
      "FINDINGS_UNAVAILABLE",
      "LIMIT_EXCEEDED",
      "IMAGE_ARCHIVED",
    ]),
    description: v.optional(v.string()),
  }),
  imageScanFindings: v.optional(
    v.object({
      // strictObject: a severity this code has never heard of stops the deploy.
      findingSeverityCounts: v.optional(
        v.strictObject({
          ...v.entriesFromList(SEVERITIES, v.optional(count)),
          UNDEFINED: v.optional(count),
        }),
      ),
    }),
  ),
});
export type ScanReport = v.InferOutput<typeof scanReportSchema>;
// #endregion report

export type Verdict = { deploy: true } | { deploy: false; retry: boolean; reason: string };

// #region decide
/**
 * Whether the image with `digest` may be deployed, given the registry's scan report.
 * Only a finished scan of that very image, with nothing at or above `failOn`, is a yes.
 */
export function decide(report: ScanReport, digest: string, failOn: Severity): Verdict {
  if (report.imageId.imageDigest !== digest) {
    return {
      deploy: false,
      retry: false,
      reason: `the report is for ${report.imageId.imageDigest}, not for the image being deployed`,
    };
  }
  const { status } = report.imageScanStatus;
  if (status === "IN_PROGRESS" || status === "PENDING") {
    return { deploy: false, retry: true, reason: `scan is ${status}` };
  }
  // COMPLETE is basic scanning's finished state; ACTIVE is an image under continuous scanning.
  if (status !== "COMPLETE" && status !== "ACTIVE") {
    return { deploy: false, retry: false, reason: `no scan result: ${status}` };
  }
  const counts = report.imageScanFindings?.findingSeverityCounts ?? {};
  const blocking = SEVERITIES.slice(SEVERITIES.indexOf(failOn)).filter(
    (severity) => (counts[severity] ?? 0) > 0,
  );
  const found = blocking.map((severity) => `${counts[severity]} ${severity}`);
  if ((counts.UNDEFINED ?? 0) > 0) {
    found.push(`${counts.UNDEFINED} UNDEFINED`);
  }
  return found.length === 0
    ? { deploy: true }
    : { deploy: false, retry: false, reason: `findings: ${found.join(", ")}` };
}
// #endregion decide
