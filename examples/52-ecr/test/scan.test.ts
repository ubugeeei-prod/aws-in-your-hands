import * as v from "valibot";
import { describe, expect, it } from "vite-plus/test";

import { decide, scanReportSchema } from "../src/scan.ts";
import { digestOf } from "./digests.ts";

const digest = digestOf("the image being deployed");

// Shaped after the API reference's sample responses. Written for these tests, not captured.
const report = (status: string, counts?: Record<string, number>, imageDigest = digest) =>
  v.parse(scanReportSchema, {
    imageId: { imageDigest },
    imageScanStatus: { status, description: "" },
    ...(counts === undefined ? {} : { imageScanFindings: { findingSeverityCounts: counts } }),
    registryId: "111122223333",
    repositoryName: "notes",
  });

describe("the deploy gate", () => {
  it("passes a finished scan with nothing at or above the threshold", () => {
    expect(decide(report("COMPLETE", { MEDIUM: 9, LOW: 3 }), digest, "HIGH")).toEqual({
      deploy: true,
    });
    expect(decide(report("COMPLETE", {}), digest, "LOW")).toEqual({ deploy: true });
  });

  it("blocks at the threshold and above it", () => {
    expect(decide(report("COMPLETE", { HIGH: 1 }), digest, "HIGH")).toMatchObject({
      deploy: false,
      retry: false,
      reason: "findings: 1 HIGH",
    });
    expect(decide(report("COMPLETE", { CRITICAL: 2, MEDIUM: 9 }), digest, "HIGH")).toMatchObject({
      reason: "findings: 2 CRITICAL",
    });
    expect(decide(report("COMPLETE", { MEDIUM: 9 }), digest, "MEDIUM")).toMatchObject({
      deploy: false,
    });
  });

  it("reads an image under continuous scanning the same way", () => {
    expect(decide(report("ACTIVE", { HIGH: 1 }), digest, "HIGH")).toMatchObject({ deploy: false });
    expect(decide(report("ACTIVE", {}), digest, "HIGH")).toEqual({ deploy: true });
  });

  it("does not take an unfinished scan for a clean one", () => {
    for (const status of ["IN_PROGRESS", "PENDING"]) {
      expect(decide(report(status), digest, "HIGH")).toMatchObject({ deploy: false, retry: true });
    }
  });

  it("does not take a scan that never happened for a clean one", () => {
    for (const status of [
      "FAILED",
      "UNSUPPORTED_IMAGE",
      "SCAN_ELIGIBILITY_EXPIRED",
      "FINDINGS_UNAVAILABLE",
      "LIMIT_EXCEEDED",
      "IMAGE_ARCHIVED",
    ]) {
      expect(decide(report(status), digest, "CRITICAL")).toEqual({
        deploy: false,
        retry: false,
        reason: `no scan result: ${status}`,
      });
    }
  });

  it("blocks on a finding the scanner could not rate", () => {
    expect(decide(report("COMPLETE", { UNDEFINED: 1 }), digest, "CRITICAL")).toMatchObject({
      deploy: false,
      reason: "findings: 1 UNDEFINED",
    });
  });

  it("refuses a clean report about another image", () => {
    const other = digestOf("what the tag pointed at a minute ago");
    expect(decide(report("COMPLETE", {}, other), digest, "HIGH")).toMatchObject({
      deploy: false,
      retry: false,
    });
  });

  it("refuses a response with a status or a severity it does not know", () => {
    expect(() => report("SKIPPED")).toThrow();
    expect(() => report("COMPLETE", { CATASTROPHIC: 1 })).toThrow();
  });
});
