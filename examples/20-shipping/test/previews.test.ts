import { describe, expect, it } from "vite-plus/test";
import { listPreviews } from "../src/previews.ts";

const now = new Date("2026-10-11T00:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const stacks = [
  { StackName: "AihShipApi", CreationTime: daysAgo(90) },
  { StackName: "AihShipApiProd", CreationTime: daysAgo(90) },
  { StackName: "AihShipApiPr12", CreationTime: daysAgo(1) },
  { StackName: "AihShipApiPr7", CreationTime: daysAgo(30) },
  { StackName: "AihShipCi", CreationTime: daysAgo(90) },
  { StackName: "AihShipApiPrx", CreationTime: daysAgo(30) },
];

describe("preview stacks", () => {
  it("never lists dev, prod, or the CI stack as a preview", () => {
    const previews = listPreviews({ stacks, now, maxAgeDays: 7 });
    expect(previews.map((preview) => preview.stack)).toEqual(["AihShipApiPr7", "AihShipApiPr12"]);
  });

  it("flags a preview nobody has deleted for longer than the limit", () => {
    const previews = listPreviews({ stacks, now, maxAgeDays: 7 });
    expect(previews.map((preview) => preview.verdict)).toEqual(["old", "recent"]);
  });

  it("flags a preview whose pull request is closed, however new it is", () => {
    const previews = listPreviews({ stacks, now, maxAgeDays: 7, openPullRequests: [7] });
    expect(previews).toEqual([
      { stack: "AihShipApiPr7", pullRequest: 7, ageDays: 30, verdict: "old" },
      { stack: "AihShipApiPr12", pullRequest: 12, ageDays: 1, verdict: "leftover" },
    ]);
  });
});
