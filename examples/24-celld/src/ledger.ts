import type { Attempt, ProbeOutput } from "./probe.ts";

// The client's side of the story: what it asked for and what it was told.
// Nothing here knows how celld works. It only knows the counter: every
// request to a cell adds 1 and answers with the new value.

// #region invariant
export type Violation =
  | {
      kind: "acknowledged-write-lost";
      cell: number;
      seq: number;
      detail: string;
    }
  | {
      kind: "unexplained-write";
      cell: number;
      seq: number;
      detail: string;
    };

export type CellSummary = {
  cell: number;
  acknowledged: number;
  /** Requests with no usable answer. Each one may or may not have been applied. */
  unknown: number;
  longestOutage: number;
  lastValue: number | null;
};

export type Verdict = "held" | "violated" | "inconclusive";
export type LedgerReport = { verdict: Verdict; violations: Violation[]; cells: CellSummary[]; notes: string[] };

/** 200 with a number is the only acknowledgement. A timeout, a 503, or a broken body proves nothing either way. */
export const isAcknowledged = (attempt: Attempt): attempt is Attempt & { n: number } =>
  attempt.status === 200 && attempt.n !== null;

/**
 * For one cell, in request order, with `u` unanswered requests since the last acknowledgement `prev`:
 *   prev < n            an acknowledged write is still there (the counter never goes back)
 *   n <= prev + 1 + u   every extra step is explained by a request that might have been applied
 */
export function judgeCell(cell: number, attempts: Attempt[]): { summary: CellSummary; violations: Violation[] } {
  const violations: Violation[] = [];
  let previous = 0;
  let unknownSince = 0;
  let acknowledged = 0;
  let unknown = 0;
  let longestOutage = 0;
  let lastValue: number | null = null;

  for (const attempt of attempts.toSorted((left, right) => left.seq - right.seq)) {
    if (!isAcknowledged(attempt)) {
      unknown += 1;
      unknownSince += 1;
      longestOutage = Math.max(longestOutage, unknownSince);
      continue;
    }
    if (attempt.n <= previous) {
      violations.push({
        kind: "acknowledged-write-lost",
        cell,
        seq: attempt.seq,
        detail: `answered ${attempt.n} after ${previous} had been acknowledged`,
      });
    } else if (attempt.n > previous + 1 + unknownSince) {
      violations.push({
        kind: "unexplained-write",
        cell,
        seq: attempt.seq,
        detail: `answered ${attempt.n}; ${previous} acknowledged and ${unknownSince} unanswered allow at most ${previous + 1 + unknownSince}`,
      });
    }
    // Judge what follows against what the fleet now claims, so one fault is reported once.
    previous = attempt.n;
    lastValue = attempt.n;
    unknownSince = 0;
    acknowledged += 1;
  }
  return { summary: { cell, acknowledged, unknown, longestOutage, lastValue }, violations };
}
// #endregion invariant

// #region report
export type JudgeOptions = {
  /** Cells the probe was told to write to. */
  cells: number;
  /** The first request made after the fault was injected. Unset: no fault, a baseline run. */
  faultAtSeq?: number;
};

/**
 * "held" needs evidence: a complete ledger, and for every cell an acknowledgement
 * after the fault. A cell that never answered again says nothing about its writes.
 */
export function judge(output: ProbeOutput, options: JudgeOptions): LedgerReport {
  const notes: string[] = [];
  const byCell = Map.groupBy(output.attempts, (attempt) => attempt.cell);
  const cells: CellSummary[] = [];
  const violations: Violation[] = [];
  let inconclusive = false;

  if (!output.complete) {
    inconclusive = true;
    notes.push("the probe output is incomplete (no matching DONE line): the ledger may be missing requests");
  }
  if (output.malformed.length > 0) {
    inconclusive = true;
    notes.push(`${output.malformed.length} line(s) of probe output were not understood`);
  }

  for (let cell = 1; cell <= options.cells; cell += 1) {
    const attempts = byCell.get(cell) ?? [];
    const judged = judgeCell(cell, attempts);
    cells.push(judged.summary);
    violations.push(...judged.violations);

    const before = attempts.filter((attempt) => options.faultAtSeq === undefined || attempt.seq < options.faultAtSeq);
    const after = attempts.filter((attempt) => options.faultAtSeq !== undefined && attempt.seq >= options.faultAtSeq);
    if (!before.some(isAcknowledged)) {
      inconclusive = true;
      notes.push(`cell ${cell}: nothing was acknowledged before the fault, so there was nothing to lose`);
    }
    if (options.faultAtSeq !== undefined && !after.some(isAcknowledged)) {
      inconclusive = true;
      notes.push(`cell ${cell}: no acknowledgement after the fault, so its earlier writes were never read back`);
    }
  }
  for (const cell of byCell.keys()) {
    if (cell < 1 || cell > options.cells) {
      inconclusive = true;
      notes.push(`the output mentions cell ${cell}, which the probe was not asked to write`);
    }
  }

  const verdict: Verdict = violations.length > 0 ? "violated" : inconclusive ? "inconclusive" : "held";
  return { verdict, violations, cells, notes };
}

/** One ledger from several probe runs, in the order they ran. */
export function joinLedgers(outputs: ProbeOutput[]): ProbeOutput {
  const attempts: Attempt[] = [];
  for (const output of outputs) {
    const offset = attempts.length;
    attempts.push(...output.attempts.map((attempt) => ({ ...attempt, seq: offset + attempt.seq })));
  }
  return {
    attempts,
    complete: outputs.every((output) => output.complete),
    malformed: outputs.flatMap((output) => output.malformed),
  };
}

export function describeReport(report: LedgerReport): string[] {
  const lines = [
    `verdict: ${report.verdict}`,
    ...report.cells.map(
      (cell) =>
        `  cell ${String(cell.cell).padStart(2)}  acknowledged ${String(cell.acknowledged).padStart(4)}  unanswered ${String(cell.unknown).padStart(4)}  longest gap ${String(cell.longestOutage).padStart(3)}  last value ${cell.lastValue ?? "-"}`,
    ),
    ...report.violations.map(
      (violation) =>
        `  VIOLATION ${violation.kind}: cell ${violation.cell}, request ${violation.seq}: ${violation.detail}`,
    ),
    ...report.notes.map((note) => `  note: ${note}`),
  ];
  if (report.verdict === "held") {
    lines.push("  Every acknowledged increment was still there afterwards, and no counter moved without a request.");
    lines.push("  This says so for these requests and this one fault. It is not a proof about celld.");
  }
  return lines;
}
// #endregion report
