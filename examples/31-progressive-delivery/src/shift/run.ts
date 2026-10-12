import {
  type AlarmReading,
  decide,
  type Limits,
  mayStart,
  type Observation,
  type ShiftState,
} from "./decide.ts";
import { aliasAt, type AliasTarget, percentOf, type ShiftPlan } from "./plan.ts";

// #region ports
/** The alias changed after it was read. Whoever changed it knows something this run does not. */
export class RevisionConflictError extends Error {
  constructor() {
    super("The alias was changed by someone else.");
    this.name = "RevisionConflictError";
  }
}

export type AliasView = AliasTarget & { revisionId: string };

export type AliasPort = {
  read(): Promise<AliasView>;
  /** Sets the alias to exactly `target`, or throws RevisionConflictError when `revisionId` is stale. */
  write(target: AliasTarget, revisionId: string): Promise<AliasView>;
};

export type AlarmPort = { read(): Promise<AlarmReading[]> };

export type Clock = { now(): number; sleep(milliseconds: number): Promise<void> };
// #endregion ports

export type ShiftOptions = {
  alias: AliasPort;
  alarms: AlarmPort;
  clock: Clock;
  plan: ShiftPlan;
  /** The version to move to. The version to move from is whatever the alias names now. */
  to: string;
  pollSeconds: number;
  limits: Limits;
  log: (line: string) => void;
};

// #region outcome
export type ShiftOutcome =
  | { outcome: "completed"; from: string; to: string }
  | { outcome: "rolled-back"; from: string; to: string; reason: string }
  /** Nothing was changed. */
  | { outcome: "refused"; reason: string }
  /** The alias was left as found, because this run could no longer claim to own it. */
  | { outcome: "abandoned"; reason: string };
// #endregion outcome

const same = (a: AliasTarget, b: AliasTarget) =>
  a.version === b.version &&
  JSON.stringify(Object.entries(a.weights).toSorted()) ===
    JSON.stringify(Object.entries(b.weights).toSorted());

const describe = (alias: AliasTarget) => {
  const weights = Object.entries(alias.weights).map(
    ([version, weight]) => `${Math.round(weight * 100)}% on ${version}`,
  );
  return weights.length === 0
    ? `100% on ${alias.version}`
    : `${weights.join(", ")}, the rest on ${alias.version}`;
};

// #region put
/**
 * One write that survives a lost answer. A write sets absolute weights, so sending it
 * twice is harmless. What is not harmless is writing over a change someone else made.
 */
async function put(
  alias: AliasPort,
  target: AliasTarget,
  revisionId: string,
  attempts: number,
): Promise<AliasView | "conflict"> {
  let revision = revisionId;
  let failure: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await alias.write(target, revision);
    } catch (error) {
      if (error instanceof RevisionConflictError) {
        return "conflict";
      }
      failure = error;
    }
    try {
      const seen = await alias.read();
      if (same(seen, target)) {
        // The write went through. Only its answer was lost.
        return seen;
      }
      if (seen.revisionId !== revision) {
        return "conflict";
      }
      revision = seen.revisionId;
    } catch (error) {
      failure = error;
    }
  }
  throw new Error(`The alias could not be written in ${attempts} attempts.`, { cause: failure });
}
// #endregion put

// #region run
export async function runShift(options: ShiftOptions): Promise<ShiftOutcome> {
  const { alias, alarms, clock, plan, to, log } = options;
  const observe = async (): Promise<Observation> => {
    try {
      return { kind: "alarms", alarms: await alarms.read() };
    } catch {
      return { kind: "unreadable" };
    }
  };

  let view = await alias.read();
  if (view.version === to && Object.keys(view.weights).length === 0) {
    return { outcome: "completed", from: to, to };
  }
  const from = view.version;
  const found = percentOf(view, from, to);
  if (found === undefined) {
    return { outcome: "refused", reason: `another shift is in progress: ${describe(view)}` };
  }

  let step: number;
  if (found === 0) {
    const start = mayStart(await observe());
    if (!start.ok) {
      return { outcome: "refused", reason: start.reason };
    }
    step = 0;
  } else {
    // An earlier run stopped partway. Take up the last step it reached, and watch it afresh.
    step = Math.max(
      0,
      plan.steps.findLastIndex((candidate) => candidate.percent <= found),
    );
    log(`resuming at ${found}%`);
  }

  const apply = async (index: number): Promise<ShiftState | "conflict"> => {
    const percent = plan.steps[index]?.percent ?? 100;
    const written = await put(alias, aliasAt(percent, from, to), view.revisionId, 3);
    if (written === "conflict") {
      return "conflict";
    }
    view = written;
    log(`${percent}% on version ${to}`);
    return { step: index, stepStartedAt: clock.now(), blindSince: null };
  };

  const abandoned = (during: string): ShiftOutcome => ({
    outcome: "abandoned",
    reason: `the alias was changed by someone else ${during}`,
  });

  const applied = await apply(step);
  if (applied === "conflict") {
    return abandoned("before the first step");
  }
  let state = applied;

  for (;;) {
    await clock.sleep(options.pollSeconds * 1000);
    const result = decide(plan, state, await observe(), clock.now(), options.limits);
    state = result.state;
    const { decision } = result;
    if (decision.action === "wait") {
      continue;
    }
    if (decision.action === "complete") {
      return { outcome: "completed", from, to };
    }
    if (decision.action === "advance") {
      const next = await apply(decision.toStep);
      if (next === "conflict") {
        return abandoned("during the shift");
      }
      state = next;
      continue;
    }
    // Going back matters more than going forward, so it gets more attempts.
    log(`rolling back: ${decision.reason}`);
    const back = await put(alias, aliasAt(0, from, to), view.revisionId, 5);
    if (back === "conflict") {
      return abandoned(`before the rollback (${decision.reason})`);
    }
    return { outcome: "rolled-back", from, to, reason: decision.reason };
  }
}
// #endregion run
