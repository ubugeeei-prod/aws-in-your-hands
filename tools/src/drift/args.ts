// What each drift task passes to `cdkd drift`. The book prints these beside the task's name.

export const MODES = ["check", "preview-revert", "revert", "accept"] as const;
export type Mode = (typeof MODES)[number];

export function driftArgs(mode: Mode, stack: string): string[] {
  // --accept rewrites the state only: the CDK source still has the old value.
  // --revert writes the recorded values back to AWS.
  const flags = {
    check: ["--json"],
    "preview-revert": ["--revert", "--dry-run"],
    revert: ["--revert"],
    accept: ["--accept"],
  }[mode];
  return ["drift", stack, ...flags];
}

export function isMode(value: string | undefined): value is Mode {
  return (MODES as readonly string[]).includes(value ?? "");
}
