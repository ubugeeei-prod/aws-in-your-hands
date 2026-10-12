// How many pods may be missing at once, worked out from the three numbers that decide it:
// the Deployment's rolling update, the PodDisruptionBudget, and a node being drained.
// Arithmetic from the Kubernetes documentation. No cluster is asked.

/** A number of pods, or a share of them written as "25%". */
export type IntOrPercent = number | string;

// #region resolve
export function resolve(value: IntOrPercent, total: number, round: "up" | "down"): number {
  if (typeof value === "number") {
    return value;
  }
  const match = /^(\d+)%$/.exec(value);
  if (match === null) {
    throw new Error(`"${value}" is neither a number of pods nor a percentage`);
  }
  const exact = (total * Number(match[1])) / 100;
  return round === "up" ? Math.ceil(exact) : Math.floor(exact);
}
// #endregion resolve

// #region rolling
export type RollingUpdate = {
  replicas: number;
  maxSurge: IntOrPercent;
  maxUnavailable: IntOrPercent;
};

export type RolloutBounds = {
  /** Pods a rollout may add on top of `replicas`. A percentage rounds up. */
  surge: number;
  /** Ready pods a rollout may take away. A percentage rounds down. */
  unavailable: number;
  minAvailable: number;
  maxTotal: number;
};

export function rolloutBounds(update: RollingUpdate): RolloutBounds {
  const surge = resolve(update.maxSurge, update.replicas, "up");
  const unavailable = resolve(update.maxUnavailable, update.replicas, "down");
  if (surge === 0 && unavailable === 0) {
    // Nothing may be added and nothing may be removed. Kubernetes refuses 0 and 0 as written;
    // what it does when two percentages both come out as 0 was not checked for this book.
    throw new Error("maxSurge and maxUnavailable both come to 0, so a rollout could not start");
  }
  return {
    surge,
    unavailable,
    minAvailable: update.replicas - unavailable,
    maxTotal: update.replicas + surge,
  };
}

export type RolloutStep = { old: number; new: number; available: number; total: number };

/**
 * The steps of a rollout in which every new pod becomes available. A model: all the pods
 * started in one step become available together, which a real cluster does not promise.
 */
export function rolloutSteps(update: RollingUpdate): RolloutStep[] {
  const { minAvailable, maxTotal } = rolloutBounds(update);
  let old = update.replicas;
  let fresh = 0;
  let freshAvailable = 0;
  const steps: RolloutStep[] = [];
  const record = (): void =>
    void steps.push({ old, new: fresh, available: old + freshAvailable, total: old + fresh });

  record();
  while (old > 0 || fresh < update.replicas) {
    // Take away as many old pods as the floor allows.
    const removable = Math.min(old, old + freshAvailable - minAvailable);
    if (removable > 0) {
      old -= removable;
      record();
    }
    // Start as many new pods as the ceiling allows.
    const startable = Math.min(update.replicas - fresh, maxTotal - (old + fresh));
    if (startable > 0) {
      fresh += startable;
      record();
    }
    if (freshAvailable < fresh) {
      freshAvailable = fresh;
      record();
    }
  }
  return steps;
}
// #endregion rolling

// #region budget
export type DisruptionBudget = { minAvailable: IntOrPercent } | { maxUnavailable: IntOrPercent };

export type Allowance = {
  /** Healthy pods the budget insists on. */
  desiredHealthy: number;
  /** Evictions the API would accept right now. */
  allowed: number;
};

/**
 * `expected` is the Deployment's replicas, `healthy` the pods that are ready now.
 * Both kinds of percentage round up, as the documentation says.
 */
export function disruptionsAllowed(
  budget: DisruptionBudget,
  expected: number,
  healthy: number,
): Allowance {
  const desiredHealthy =
    "minAvailable" in budget
      ? resolve(budget.minAvailable, expected, "up")
      : Math.max(0, expected - resolve(budget.maxUnavailable, expected, "up"));
  return { desiredHealthy, allowed: Math.max(0, healthy - desiredHealthy) };
}
// #endregion budget

// #region drain
export type Pod = { name: string; node: string };

export type DrainEvent =
  | { round: number; kind: "evicted"; pod: string }
  | { round: number; kind: "refused"; pod: string }
  | { round: number; kind: "replaced"; pod: string; node: string };

export type DrainResult = {
  events: DrainEvent[];
  /** The fewest healthy pods at any moment of the drain. */
  lowestHealthy: number;
  /** True when the budget refuses every eviction and nothing is on its way to change that. */
  stuck: boolean;
};

/**
 * Drains one node. Each round asks to evict every pod still on the node, in order; an
 * eviction the budget does not allow is refused (the API answers 429). After the round,
 * every evicted pod has a healthy replacement on `elsewhere`. Without a budget nothing
 * is ever refused.
 */
export function drainNode(input: {
  pods: Pod[];
  node: string;
  elsewhere: string;
  replicas: number;
  budget?: DisruptionBudget;
}): DrainResult {
  const { node, elsewhere, replicas, budget } = input;
  let onNode = input.pods.filter((pod) => pod.node === node).map((pod) => pod.name);
  let healthy = input.pods.length;
  let lowestHealthy = healthy;
  const events: DrainEvent[] = [];

  for (let round = 1; onNode.length > 0; round += 1) {
    const evicted: string[] = [];
    for (const pod of onNode) {
      const allowed =
        budget === undefined ? 1 : disruptionsAllowed(budget, replicas, healthy).allowed;
      if (allowed === 0) {
        events.push({ round, kind: "refused", pod });
        continue;
      }
      healthy -= 1;
      lowestHealthy = Math.min(lowestHealthy, healthy);
      evicted.push(pod);
      events.push({ round, kind: "evicted", pod });
    }
    if (evicted.length === 0) {
      return { events, lowestHealthy, stuck: true };
    }
    onNode = onNode.filter((pod) => !evicted.includes(pod));
    for (const pod of evicted) {
      healthy += 1;
      events.push({ round, kind: "replaced", pod, node: elsewhere });
    }
  }
  return { events, lowestHealthy, stuck: false };
}
// #endregion drain

// #region floor
/**
 * The fewest healthy pods that voluntary disruptions can leave, when a rollout and a drain
 * overlap. A rollout is not held back by the budget, but the pods it has taken away count
 * against it, so the drain waits. A node that simply fails is not a voluntary disruption:
 * no number here covers it.
 */
export function availabilityFloor(update: RollingUpdate, budget?: DisruptionBudget): number {
  const duringRollout = rolloutBounds(update).minAvailable;
  if (budget === undefined) {
    // Nothing refuses an eviction. If every pod sits on the drained node, all of them go.
    return 0;
  }
  const { desiredHealthy } = disruptionsAllowed(budget, update.replicas, update.replicas);
  return Math.min(duringRollout, desiredHealthy);
}
// #endregion floor
