import { describe, expect, it } from "vite-plus/test";
import { type Timing, timing, timingProblems } from "../src/timing.ts";

const withChange = (change: Partial<Timing>): Timing => ({ ...timing, ...change });

describe("the durations the server and the stack share", () => {
  it("fit together as shipped", () => {
    expect(timingProblems(timing)).toEqual([]);
  });

  // #region broken
  it("reports a server that hangs up before the load balancer does", () => {
    // Node's default keep-alive timeout is 5 seconds; the load balancer's idle timeout is 60.
    expect(timingProblems(withChange({ serverKeepAlive: 5 }))).toEqual([expect.stringContaining("502")]);
  });

  it("reports a stop timeout that ends before the server's own deadline", () => {
    expect(timingProblems(withChange({ stopTimeout: 20 }))).toEqual([expect.stringContaining("SIGKILL")]);
  });

  it("reports a deregistration delay shorter than the longest request", () => {
    expect(timingProblems(withChange({ deregistrationDelay: 5 }))).toEqual([
      expect.stringContaining("load balancer cuts a request"),
    ]);
  });
  // #endregion broken

  it("reports values outside what Fargate and the load balancer accept", () => {
    expect(timingProblems(withChange({ stopTimeout: 121 }))).toHaveLength(1);
    expect(timingProblems(withChange({ healthCheckInterval: 4, healthCheckTimeout: 2 }))).toHaveLength(1);
    expect(timingProblems(withChange({ healthyThreshold: 1 }))).toHaveLength(1);
  });
});
