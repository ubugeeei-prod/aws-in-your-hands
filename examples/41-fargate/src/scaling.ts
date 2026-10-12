// A model of target tracking, written from the documented behaviour: it scales
// out in proportion to the metric, in on a sustained lower value, and never in
// during the scale-in cooldown. It is not Application Auto Scaling. Where the
// documentation gives no number, the number is a parameter of the model.

// #region types
export type Policy = {
  /** Target for requests per task per minute (ALBRequestCountPerTarget). */
  targetPerTask: number;
  minTasks: number;
  maxTasks: number;
  /** Minutes after a scale-in before the next one may start. */
  scaleInCooldown: number;
};

export type Model = {
  /** Minutes the metric has to stay above the target before tasks are added. Not documented; assumed. */
  outAfter: number;
  /** Minutes it has to stay low before tasks are removed. Not documented; assumed. */
  inAfter: number;
  /** "Low" means below this share of the target. The documentation says "usually more than 10% lower". */
  inBelow: number;
  /** Minutes from the decision until a new task takes requests: image pull, start, first health check. */
  startMinutes: number;
  /** Requests per minute one task answers before requests queue or fail. Measure it; this is a guess. */
  capacityPerTask: number;
};

export type Minute = {
  minute: number;
  load: number;
  /** Tasks taking requests during this minute. */
  serving: number;
  /** Tasks the service was asked for, including the ones still starting. */
  desired: number;
  /** Requests per serving task: what the policy looks at. */
  perTask: number;
  /** Requests beyond what the serving tasks can answer. */
  overCapacity: number;
  action: "out" | "in" | null;
  /** Tasks taken away at the end of this minute. */
  removed: number;
};
// #endregion types

// #region simulate
/** One step per minute. `load[t]` is the number of requests that arrive in minute t. */
export function simulate(load: readonly number[], policy: Policy, model: Model): Minute[] {
  let serving = policy.minTasks;
  let desired = policy.minTasks;
  /** Minute at which each starting task begins to serve. */
  let starting: number[] = [];
  let above = 0;
  let below = 0;
  let lastIn = Number.NEGATIVE_INFINITY;
  const timeline: Minute[] = [];

  load.forEach((requests, minute) => {
    serving += starting.filter((ready) => ready <= minute).length;
    starting = starting.filter((ready) => ready > minute);

    const perTask = requests / serving;
    above = perTask > policy.targetPerTask ? above + 1 : 0;
    below = perTask < policy.targetPerTask * model.inBelow ? below + 1 : 0;

    let action: Minute["action"] = null;
    let removed = 0;
    // The size that would put the metric back at the target, from the tasks actually serving.
    const wanted = Math.ceil(requests / policy.targetPerTask);

    if (above >= model.outAfter) {
      const next = Math.min(policy.maxTasks, wanted);
      // Tasks still starting count as present, so only a larger answer adds more.
      if (next > desired) {
        starting.push(...Array.from({ length: next - desired }, () => minute + model.startMinutes));
        desired = next;
        action = "out";
      }
    } else if (
      below >= model.inAfter &&
      starting.length === 0 &&
      minute - lastIn >= policy.scaleInCooldown
    ) {
      const next = Math.max(policy.minTasks, wanted);
      if (next < desired) {
        removed = desired - next;
        desired = next;
        action = "in";
        lastIn = minute;
      }
    }

    timeline.push({
      minute,
      load: requests,
      serving,
      desired,
      perTask: Math.round(perTask),
      overCapacity: Math.max(0, requests - serving * model.capacityPerTask),
      action,
      removed,
    });
    // A removed task stops receiving new requests at once; what it still holds is drain.ts's subject.
    serving -= removed;
  });
  return timeline;
}
// #endregion simulate

// #region curve
/**
 * A morning in requests per minute: quiet, a rise over ten minutes to five times
 * the base, forty minutes at the top, and a fall. Written by hand to have the
 * shape of a recorded curve; no service produced it.
 */
export function morningCurve(): number[] {
  const quiet = 600;
  const peak = 3000;
  const rise = Array.from(
    { length: 10 },
    (_, index) => quiet + ((peak - quiet) * (index + 1)) / 10,
  );
  return [
    ...Array.from({ length: 10 }, () => quiet),
    ...rise,
    ...Array.from({ length: 40 }, () => peak),
    ...rise.toReversed(),
    ...Array.from({ length: 50 }, () => quiet),
  ];
}
// #endregion curve

export type Summary = {
  peakTasks: number;
  /** Requests that arrived while the serving tasks were already full. */
  overCapacity: number;
  /** First minute at which a task was added, and the minute it began to serve. */
  firstOut: { decided: number; serving: number } | null;
  scaleIns: { minute: number; removed: number }[];
  taskMinutes: number;
};

export function summarize(timeline: readonly Minute[], model: Model): Summary {
  const firstOut = timeline.find((entry) => entry.action === "out");
  return {
    peakTasks: Math.max(...timeline.map((entry) => entry.serving)),
    overCapacity: timeline.reduce((sum, entry) => sum + entry.overCapacity, 0),
    firstOut:
      firstOut === undefined
        ? null
        : { decided: firstOut.minute, serving: firstOut.minute + model.startMinutes },
    scaleIns: timeline
      .filter((entry) => entry.action === "in")
      .map((entry) => ({ minute: entry.minute, removed: entry.removed })),
    taskMinutes: timeline.reduce((sum, entry) => sum + entry.serving, 0),
  };
}
