import { timing, timingProblems } from "@aih/example-12-containers/src/timing.ts";

// #region timing
/**
 * Chapter 12's durations, which the server in the image still runs with, plus
 * the ones Kubernetes adds. The manifests read this object and nothing else.
 */
export const podTiming = {
  ...timing,

  /**
   * Kubernetes sends SIGTERM and takes the pod out of the Service at the same
   * moment, so the container waits this long before the signal reaches it.
   */
  preStopSleep: 15,
  /** From the start of the preStop hook to SIGKILL. The hook's time counts against it. */
  terminationGracePeriod: 45,
  /**
   * How long the load balancer is assumed to need before it stops sending to a
   * pod that is going away. An assumption: nobody measured it for this book.
   */
  deregistrationLag: 10,

  readinessPeriod: 5,
  readinessFailureThreshold: 2,
  livenessPeriod: 10,
  livenessFailureThreshold: 3,
  /** A new pod counts as available only after it has been ready this long. */
  minReadySeconds: 30,
} as const;

export type PodTiming = { [Key in keyof typeof podTiming]: number };
// #endregion timing

// #region rules
/** Why a set of durations would drop requests on Kubernetes. Empty when it would not. */
export function podTimingProblems(t: PodTiming): string[] {
  const problems: string[] = [];
  const check = (ok: boolean, message: string): void => void (ok || problems.push(message));

  // What is left of the grace period once the hook has slept is what ECS called stopTimeout.
  const afterSigterm = t.terminationGracePeriod - t.preStopSleep;
  problems.push(
    ...timingProblems({ ...t, stopTimeout: afterSigterm })
      // The 2 to 120 second range is Fargate's. Kubernetes has no such bound.
      .filter((problem) => !problem.includes("Fargate")),
  );

  check(
    t.preStopSleep >= t.deregistrationLag,
    "SIGTERM reaches the server while the load balancer may still be sending it new requests",
  );
  check(
    t.minReadySeconds >= t.healthCheckInterval * t.healthyThreshold,
    "a rollout may count a new pod as available before the load balancer has checked it",
  );
  check(
    t.livenessPeriod * t.livenessFailureThreshold > t.readinessPeriod * t.readinessFailureThreshold,
    "the kubelet restarts a slow pod before it has had the chance to just stop receiving traffic",
  );
  return problems;
}
// #endregion rules
