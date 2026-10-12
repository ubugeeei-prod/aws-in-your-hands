import type { ShiftPlan } from "./plan.ts";

// #region types
/** The three states CloudWatch gives an alarm. */
export type AlarmState = "OK" | "ALARM" | "INSUFFICIENT_DATA";

export type AlarmReading = { name: string; state: AlarmState };

/** What one poll learned. `unreadable` is a poll that failed: no answer is not a good answer. */
export type Observation = { kind: "alarms"; alarms: AlarmReading[] } | { kind: "unreadable" };

export type ShiftState = {
  /** Index into plan.steps of the weight that is applied now. */
  step: number;
  /** When that weight was applied, in milliseconds. */
  stepStartedAt: number;
  /** Since when the alarms have not been able to vouch for the new version, or null. */
  blindSince: number | null;
};

export type Decision =
  | { action: "wait" }
  | { action: "advance"; toStep: number }
  | { action: "complete" }
  | { action: "rollback"; reason: string };

export type Limits = {
  /** How long the shift may go on without every alarm saying OK before it gives up. */
  maxBlindSeconds: number;
};
// #endregion types

// #region decide
/** One poll in, one decision out. No clock, no AWS: the caller brings both. */
export function decide(
  plan: ShiftPlan,
  state: ShiftState,
  observation: Observation,
  now: number,
  limits: Limits,
): { decision: Decision; state: ShiftState } {
  const firing =
    observation.kind === "alarms"
      ? observation.alarms.filter((alarm) => alarm.state === "ALARM")
      : [];
  if (firing.length > 0) {
    const names = firing.map((alarm) => alarm.name).join(", ");
    return { decision: { action: "rollback", reason: `in ALARM: ${names}` }, state };
  }

  const vouched =
    observation.kind === "alarms" &&
    observation.alarms.length > 0 &&
    observation.alarms.every((alarm) => alarm.state === "OK");
  if (!vouched) {
    const blindSince = state.blindSince ?? now;
    const blindFor = (now - blindSince) / 1000;
    // An alarm that cannot be read protects nobody. Waiting forever at 10% is not a plan either.
    return blindFor >= limits.maxBlindSeconds
      ? {
          decision: {
            action: "rollback",
            reason: `no alarm reading for ${Math.round(blindFor)} seconds`,
          },
          state: { ...state, blindSince },
        }
      : { decision: { action: "wait" }, state: { ...state, blindSince } };
  }

  const seen = { ...state, blindSince: null };
  const current = plan.steps[state.step];
  if (current === undefined) {
    throw new Error(`The plan ${plan.name} has no step ${state.step}.`);
  }
  if (now - state.stepStartedAt < current.holdSeconds * 1000) {
    return { decision: { action: "wait" }, state: seen };
  }
  return state.step === plan.steps.length - 1
    ? { decision: { action: "complete" }, state: seen }
    : { decision: { action: "advance", toStep: state.step + 1 }, state: seen };
}
// #endregion decide

// #region start
/** A shift does not start under an alarm that is already firing: it could not tell its own damage apart. */
export function mayStart(observation: Observation): { ok: true } | { ok: false; reason: string } {
  if (observation.kind === "unreadable") {
    return { ok: false, reason: "the alarms could not be read" };
  }
  if (observation.alarms.length === 0) {
    return { ok: false, reason: "there is no alarm to watch" };
  }
  const firing = observation.alarms.filter((alarm) => alarm.state === "ALARM");
  return firing.length === 0
    ? { ok: true }
    : {
        ok: false,
        reason: `already in ALARM: ${firing.map((alarm) => alarm.name).join(", ")}`,
      };
}
// #endregion start
