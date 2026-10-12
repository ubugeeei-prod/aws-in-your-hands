import { SCALING } from "./config.ts";
import type { Model, Policy } from "./scaling.ts";

// #region defaults
/** The deployed policy, in the simulation's units (minutes). */
export const POLICY: Policy = {
  targetPerTask: SCALING.targetRequestsPerTask,
  minTasks: SCALING.minTasks,
  maxTasks: SCALING.maxTasks,
  scaleInCooldown: SCALING.scaleInCooldown / 60,
};

/** Everything here is an assumption of the model. Replace each number with one you measured. */
export const MODEL: Model = {
  outAfter: 3,
  inAfter: 15,
  inBelow: 0.9,
  startMinutes: 2,
  capacityPerTask: 900,
};
// #endregion defaults
