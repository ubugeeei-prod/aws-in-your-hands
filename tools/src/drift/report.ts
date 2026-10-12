import * as v from "valibot";

import { driftOutputSchema, type StackDrift } from "./schema.ts";

// A zero exit code from `cdkd drift` is not "no drift" on its own: matching,
// differing, and never-compared resources are kept apart.

/** Worst first. A report takes the worst status of its stacks. */
export const STATUSES = [
  "failed",
  "missing-target",
  "deleted",
  "drifted",
  "incomplete",
  "unsupported",
  "clean",
] as const;
export type Status = (typeof STATUSES)[number];

export type Uninspected = { logicalId: string; type: string; reason: string };

export type StackReport = {
  stack: string;
  region: string | null;
  status: Status;
  detail: string;
  counts: { clean: number; drifted: number; deleted: number; uninspected: number };
  drifted: { logicalId: string; type: string; paths: string[] }[];
  deleted: { logicalId: string; type: string }[];
  uninspected: Uninspected[];
  warnings: string[];
};

export type DriftReport = {
  schemaVersion: 1;
  tool: { name: "cdkd"; version: string };
  target: { accountId: string; region: string };
  requestedStacks: string[];
  executedAt: string;
  exitCode: number;
  status: Status;
  stacks: StackReport[];
  gate: { passed: boolean; exitCode: number; reason: string };
};

export type RunResult = { exitCode: number; stdout: string; stderr: string };

const worst = (statuses: Status[]): Status =>
  STATUSES.find((status) => statuses.includes(status)) ?? "failed";

function reportStack(entry: StackDrift): StackReport {
  const uninspected: Uninspected[] = [
    ...entry.notCompared.map((r) => ({
      logicalId: r.logicalId,
      type: r.type,
      reason: `not compared: ${r.cause}`,
    })),
    ...entry.notSupported.map((r) => ({
      logicalId: r.logicalId,
      type: r.type,
      reason: "no read-back for this type",
    })),
    ...entry.skipped.map((r) => ({
      logicalId: r.logicalId,
      type: r.type,
      reason: "skipped by cdkd",
    })),
  ];
  const counts = {
    clean: entry.clean.length,
    drifted: entry.drifted.length,
    deleted: entry.deleted.length,
    uninspected: uninspected.length,
  };
  const total = counts.clean + counts.drifted + counts.deleted + counts.uninspected;

  let status: Status;
  let detail: string;
  if (total === 0) {
    // No resources listed is not evidence of anything.
    status = "incomplete";
    detail = "The report lists no resources for this stack, so nothing was compared.";
  } else if (counts.deleted > 0) {
    status = "deleted";
    detail = `${counts.deleted} resource(s) recorded in the state no longer exist in AWS.`;
  } else if (counts.drifted > 0) {
    status = "drifted";
    detail = `${counts.drifted} resource(s) differ from the recorded state.`;
  } else if (entry.notCompared.length > 0) {
    status = "incomplete";
    detail = `${entry.notCompared.length} resource(s) could not be compared.`;
  } else if (uninspected.length > 0) {
    status = "unsupported";
    detail = `${uninspected.length} resource(s) cannot be read back and were not compared.`;
  } else {
    status = "clean";
    detail = `All ${counts.clean} resource(s) were compared and match.`;
  }

  return {
    stack: entry.stack,
    region: entry.region,
    status,
    detail,
    counts,
    drifted: entry.drifted.map((r) => ({
      logicalId: r.logicalId,
      type: r.type,
      paths: r.changes.map((c) => c.path),
    })),
    deleted: entry.deleted.map((r) => ({ logicalId: r.logicalId, type: r.type })),
    uninspected,
    warnings: entry.warnings ?? [],
  };
}

const placeholder = (stack: string, status: Status, detail: string): StackReport => ({
  stack,
  region: null,
  status,
  detail,
  counts: { clean: 0, drifted: 0, deleted: 0, uninspected: 0 },
  drifted: [],
  deleted: [],
  uninspected: [],
  warnings: [],
});

function reportStacks(requested: string[], run: RunResult): StackReport[] {
  const everyStack = (status: Status, detail: string) =>
    requested.map((stack) => placeholder(stack, status, detail));

  // cdkd documents 0 (no drift), 1 (drift, or the command failed) and
  // 2 (no drift found, but some resources were not compared).
  if (![0, 1, 2].includes(run.exitCode)) {
    return everyStack(
      "failed",
      `cdkd exited with ${run.exitCode}, which is not a documented drift result.`,
    );
  }

  if (run.stdout.trim() === "") {
    // With --json, stdout is the payload. Empty means nothing was compared.
    return /No state found for stack/.test(run.stderr)
      ? everyStack("missing-target", "cdkd has no state for this stack in this account and region.")
      : everyStack("failed", `cdkd printed no report (exit code ${run.exitCode}).`);
  }

  let json: unknown;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    return everyStack("failed", "cdkd printed output that is not JSON.");
  }
  const parsed = v.safeParse(driftOutputSchema, json);
  if (!parsed.success) {
    return everyStack(
      "failed",
      `The report does not match the expected schema: ${parsed.issues[0].message}`,
    );
  }

  const stacks = requested.map((stack) => {
    const entry = parsed.output.find((candidate) => candidate.stack === stack);
    return entry === undefined
      ? placeholder(stack, "missing-target", "The report has no entry for this stack.")
      : reportStack(entry);
  });

  // Exit code and payload must agree. If they do not, trust neither.
  const status = worst(stacks.map((stack) => stack.status));
  const differs = status === "deleted" || status === "drifted";
  if (run.exitCode === 1 && !differs && status !== "missing-target") {
    return everyStack(
      "failed",
      "cdkd exited with 1 but the report shows no drift: the command failed part-way.",
    );
  }
  if (run.exitCode !== 1 && differs) {
    return everyStack("failed", `The report shows drift but cdkd exited with ${run.exitCode}.`);
  }
  if (run.exitCode === 2 && status === "clean") {
    return everyStack(
      "failed",
      "cdkd exited with 2 (resources not compared) but the report lists none.",
    );
  }
  return stacks;
}

// #region gate
/** Distinct so that CI can tell "differs" from "unknown". */
export const GATE_EXIT = { clean: 0, differs: 10, unverified: 11, failed: 12 } as const;

export function gateFor(status: Status): DriftReport["gate"] {
  switch (status) {
    case "clean":
      return {
        passed: true,
        exitCode: GATE_EXIT.clean,
        reason: "Every resource was compared and matches.",
      };
    case "drifted":
    case "deleted":
      return {
        passed: false,
        exitCode: GATE_EXIT.differs,
        reason: "Live configuration differs from the recorded state.",
      };
    case "incomplete":
    case "unsupported":
      return {
        passed: false,
        exitCode: GATE_EXIT.unverified,
        reason:
          "No difference was found, but some resources were not compared. Not compared is not the same as in sync.",
      };
    case "failed":
    case "missing-target":
      return {
        passed: false,
        exitCode: GATE_EXIT.failed,
        reason: "Detection did not produce a usable result.",
      };
  }
}
// #endregion gate

export function buildReport(input: {
  requestedStacks: string[];
  run: RunResult;
  target: { accountId: string; region: string };
  executedAt: Date;
  toolVersion: string;
}): DriftReport {
  if (input.requestedStacks.length === 0) {
    throw new Error(
      "At least one stack must be requested: an empty request cannot be distinguished from a clean result.",
    );
  }
  const stacks = reportStacks(input.requestedStacks, input.run);
  const status = worst(stacks.map((stack) => stack.status));
  return {
    schemaVersion: 1,
    tool: { name: "cdkd", version: input.toolVersion },
    target: input.target,
    requestedStacks: input.requestedStacks,
    executedAt: input.executedAt.toISOString(),
    exitCode: input.run.exitCode,
    status,
    stacks,
    gate: gateFor(status),
  };
}

export function summarize(report: DriftReport): string {
  const lines = [
    `drift check at ${report.executedAt}`,
    `account ${report.target.accountId}, region ${report.target.region}, cdkd ${report.tool.version} (exit ${report.exitCode})`,
  ];
  for (const stack of report.stacks) {
    const { clean, drifted, deleted, uninspected } = stack.counts;
    lines.push(
      `- ${stack.stack}: ${stack.status}`,
      `    ${stack.detail}`,
      `    compared and matching: ${clean}, drifted: ${drifted}, deleted: ${deleted}, not compared: ${uninspected}`,
      ...stack.drifted.map((r) => `    ~ ${r.logicalId} (${r.type}): ${r.paths.join(", ")}`),
      ...stack.deleted.map((r) => `    - ${r.logicalId} (${r.type})`),
      ...stack.uninspected.map((r) => `    ? ${r.logicalId} (${r.type}): ${r.reason}`),
      ...stack.warnings.map((warning) => `    ! ${warning}`),
    );
  }
  lines.push(
    `gate: ${report.gate.passed ? "PASS" : "FAIL"} (exit ${report.gate.exitCode}): ${report.gate.reason}`,
  );
  return lines.join("\n");
}
