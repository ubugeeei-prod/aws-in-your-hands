import { describe, expect, it } from "vite-plus/test";

import { type PodTiming, podTiming, podTimingProblems } from "../src/timing.ts";

const withChange = (change: Partial<PodTiming>): PodTiming => ({ ...podTiming, ...change });

describe("the durations the manifests and the server share", () => {
  it("fit together as shipped", () => {
    expect(podTimingProblems(podTiming)).toEqual([]);
  });

  // #region broken
  it("reports a grace period that the preStop sleep eats into", () => {
    // 45 - 30 leaves the server 15 seconds; its own deadline is 25.
    expect(podTimingProblems(withChange({ preStopSleep: 30 }))).toEqual([
      expect.stringContaining("SIGKILL"),
    ]);
  });

  it("reports the default grace period of 30 seconds", () => {
    expect(podTimingProblems(withChange({ terminationGracePeriod: 30 }))).toEqual([
      expect.stringContaining("SIGKILL"),
    ]);
  });

  it("reports a pod that gets SIGTERM while the load balancer may still be sending", () => {
    expect(podTimingProblems(withChange({ preStopSleep: 0, terminationGracePeriod: 30 }))).toEqual([
      expect.stringContaining("still be sending"),
    ]);
  });

  it("reports a rollout that would not wait for the load balancer's health check", () => {
    expect(podTimingProblems(withChange({ minReadySeconds: 0 }))).toEqual([
      expect.stringContaining("before the load balancer has checked it"),
    ]);
  });
  // #endregion broken

  it("still reports what chapter 12 reported, and drops the rule that was Fargate's", () => {
    expect(podTimingProblems(withChange({ serverKeepAlive: 5 }))).toEqual([
      expect.stringContaining("502"),
    ]);
    // 15 + 130: more than Fargate's 120 seconds after SIGTERM, which Kubernetes does not mind.
    expect(podTimingProblems(withChange({ terminationGracePeriod: 145 }))).toEqual([]);
  });

  it("reports a liveness probe quicker than the readiness probe", () => {
    expect(
      podTimingProblems(withChange({ livenessPeriod: 2, livenessFailureThreshold: 2 })),
    ).toEqual([expect.stringContaining("restarts a slow pod")]);
  });
});
