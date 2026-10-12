// #region job-settings
export const JOB = {
  // The version a job gets when none is named, as of 2026-10-13.
  glueVersion: "5.1",
  // The smallest a Spark job can be: two workers of 1 DPU each.
  workerType: "G.1X",
  workers: 2,
  // Minutes. Left out, a run may go on for 480 minutes, billed for every one.
  timeoutMinutes: 10,
} as const;
// #endregion job-settings
