// The order of a recovery as data: what must be true before each step may run.
// The service's recovery plans order server launches. The steps after the launch are yours.

// #region graph
export type Step = { id: string; dependsOn: readonly string[]; what: string };

/** One instance, one app, one address. Larger systems have the same shape with more nodes. */
export const NOTES_RECOVERY: readonly Step[] = [
  {
    id: "launch-instance",
    dependsOn: [],
    what: "launch the recovery instance: it owns the data volume",
  },
  {
    id: "verify-app",
    dependsOn: ["launch-instance"],
    what: "run the checks: the service is active and the notes are there",
  },
  {
    id: "fence-source",
    dependsOn: ["verify-app"],
    what: "make sure the source can no longer take a write",
  },
  {
    id: "switch-address",
    dependsOn: ["verify-app", "fence-source"],
    what: "point clients at the recovery instance",
  },
];

/** Dependencies first, ties broken by the order the steps were written in. */
export function runOrder(steps: readonly Step[]): string[] {
  const known = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!known.has(dependency)) {
        throw new Error(`step "${step.id}" depends on "${dependency}", which does not exist`);
      }
    }
  }
  const done: string[] = [];
  while (done.length < steps.length) {
    const next = steps.find(
      (step) =>
        !done.includes(step.id) && step.dependsOn.every((dependency) => done.includes(dependency)),
    );
    if (next === undefined) {
      const stuck = steps.filter((step) => !done.includes(step.id)).map((step) => step.id);
      throw new Error(`the steps depend on each other in a circle: ${stuck.join(", ")}`);
    }
    done.push(next.id);
  }
  return done;
}
// #endregion graph

// #region run
export type StepState = "pending" | "done" | "failed";
export type Progress = Record<string, StepState>;

export const freshProgress = (steps: readonly Step[]): Progress =>
  Object.fromEntries(steps.map((step) => [step.id, "pending" as const]));

export type RunResult = {
  progress: Progress;
  ran: string[];
  /** Steps that did not run because something before them failed. */
  blocked: string[];
  outcome: "complete" | "stopped";
};

/**
 * Runs what is not done yet, in order, and stops at the first failure. Call it again with the
 * returned progress to resume: done steps are skipped, the failed one is tried again. A step
 * may therefore run twice (it failed after taking effect), so every step has to be safe to repeat.
 */
export async function runRecovery(
  steps: readonly Step[],
  progress: Progress,
  execute: (step: Step) => Promise<void>,
): Promise<RunResult> {
  const next: Progress = { ...progress };
  const ran: string[] = [];
  const order = runOrder(steps);
  for (const id of order) {
    if (next[id] === "done") {
      continue;
    }
    const step = steps.find((candidate) => candidate.id === id);
    if (step === undefined) {
      throw new Error(`no step "${id}"`);
    }
    ran.push(id);
    try {
      await execute(step);
      next[id] = "done";
    } catch {
      next[id] = "failed";
      const blocked = order.slice(order.indexOf(id) + 1).filter((later) => next[later] !== "done");
      return { progress: next, ran, blocked, outcome: "stopped" };
    }
  }
  return { progress: next, ran, blocked: [], outcome: "complete" };
}
// #endregion run
