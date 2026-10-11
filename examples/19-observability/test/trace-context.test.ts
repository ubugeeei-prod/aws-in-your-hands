import { describe, expect, it } from "vite-plus/test";
import { formatTraceparent, fromXRayTraceId, parseTraceparent, toXRayTraceId } from "../src/trace-context.ts";

const traceId = "4efaaf4d1e8720b39541901950019ee5";
const parentId = "00f067aa0ba902b7";

describe("traceparent", () => {
  it("reads the trace ID, the caller's span ID and the sampled flag", () => {
    expect(parseTraceparent(`00-${traceId}-${parentId}-01`)).toEqual({ traceId, parentId, sampled: true });
    expect(parseTraceparent(`00-${traceId}-${parentId}-00`)?.sampled).toBe(false);
    // Other flag bits are reserved; only the lowest one says "sampled".
    expect(parseTraceparent(`00-${traceId}-${parentId}-02`)?.sampled).toBe(false);
  });

  it("round-trips", () => {
    const header = `00-${traceId}-${parentId}-01`;
    const parsed = parseTraceparent(header);
    expect(parsed === undefined ? undefined : formatTraceparent(parsed)).toBe(header);
  });

  it("treats anything malformed as no header", () => {
    for (const header of [
      undefined,
      "",
      "garbage",
      `00-${traceId}-${parentId}`,
      `00-${traceId.toUpperCase()}-${parentId}-01`,
      `00-${"0".repeat(32)}-${parentId}-01`,
      `00-${traceId}-${"0".repeat(16)}-01`,
      `ff-${traceId}-${parentId}-01`,
      `00-${traceId}-${parentId}-01-extra`,
    ]) {
      expect(parseTraceparent(header), String(header)).toBeUndefined();
    }
  });
});

describe("X-Ray trace IDs", () => {
  it("is the same 32 hex characters, written with a version and two hyphens", () => {
    // The example pair from the X-Ray developer guide.
    expect(toXRayTraceId(traceId)).toBe("1-4efaaf4d-1e8720b39541901950019ee5");
    expect(fromXRayTraceId("1-4efaaf4d-1e8720b39541901950019ee5")).toBe(traceId);
  });

  it("refuses the other format", () => {
    expect(() => toXRayTraceId("1-4efaaf4d-1e8720b39541901950019ee5")).toThrow();
    expect(() => fromXRayTraceId(traceId)).toThrow();
  });
});
