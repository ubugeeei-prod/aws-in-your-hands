// Where attachments are read from and written to while their keys are being moved.

// #region phases
export const PHASES = ["legacy", "dual-write", "dual-read-new", "new"] as const;
export type Phase = (typeof PHASES)[number];
export type Layout = "legacy" | "new";

/**
 * Each phase can run beside the one before it and the one after it, so the
 * code can be deployed, and rolled back, one step at a time.
 */
export function layoutOf(phase: Phase): { read: Layout; write: Layout[] } {
  switch (phase) {
    case "legacy":
      return { read: "legacy", write: ["legacy"] };
    case "dual-write":
      return { read: "legacy", write: ["legacy", "new"] };
    case "dual-read-new":
      return { read: "new", write: ["legacy", "new"] };
    case "new":
      return { read: "new", write: ["new"] };
  }
}
// #endregion phases
