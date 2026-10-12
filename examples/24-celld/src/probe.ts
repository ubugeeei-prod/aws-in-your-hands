import * as v from "valibot";

import type { NodeSpec } from "./machine.ts";

// #region plan
/** GetCommandInvocation returns the first 24,000 characters of stdout. A longer probe would lose its tail. */
export const RUN_COMMAND_STDOUT_LIMIT = 24_000;

export const probePlanSchema = v.pipe(
  v.object({
    /** Part of every cell name, so each run starts from counters nobody has touched. */
    runId: v.pipe(v.string(), v.regex(/^[a-z0-9]{4,16}$/)),
    cells: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(32)),
    rounds: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(600)),
    /** Seconds between rounds. The fault has to land while the probe is still writing. */
    pauseSeconds: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10)),
    /** curl's --max-time. Longer than CELLD_OPERATION_DEADLINE_MS would hide a stuck handoff. */
    requestTimeoutSeconds: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(30)),
  }),
  // A check on the whole plan, reported at `rounds`.
  v.forward(
    v.check(
      (plan) => probeOutputBound(plan) <= RUN_COMMAND_STDOUT_LIMIT,
      (issue) =>
        `up to ${probeOutputBound(issue.input)} characters of output; Run Command keeps ${RUN_COMMAND_STDOUT_LIMIT}`,
    ),
    ["rounds"],
  ),
);
export type ProbePlan = v.InferOutput<typeof probePlanSchema>;

/** The longest output the script can print: every counter at its widest. */
export function probeOutputBound(plan: { cells: number; rounds: number }): number {
  const total = plan.cells * plan.rounds;
  const line = `P ${total} ${plan.cells} 000 ${total + 1}\n`.length;
  return total * line + `DONE ${total}\n`.length;
}

export const defaultProbePlan = (runId: string): ProbePlan =>
  v.parse(probePlanSchema, {
    runId,
    cells: 8,
    rounds: 90,
    pauseSeconds: 1,
    requestTimeoutSeconds: 20,
  });
/**
 * The most requests the probe can have made `seconds` after it started: it pauses
 * between rounds, so it cannot be faster than one round per pause. Anything later
 * in the ledger was certainly sent after that moment.
 */
export function lastSeqBefore(
  plan: Pick<ProbePlan, "cells" | "rounds" | "pauseSeconds">,
  seconds: number,
): number {
  const rounds =
    plan.pauseSeconds === 0
      ? plan.rounds
      : Math.min(plan.rounds, Math.floor(seconds / plan.pauseSeconds) + 1);
  return rounds * plan.cells;
}
// #endregion plan

// #region script
/**
 * Runs on a node, against that node's own Worker listener. One request at a time,
 * so the order of the lines is the order the requests were made in.
 */
export function renderProbeScript(spec: Pick<NodeSpec, "publicPort">, input: ProbePlan): string {
  const plan = v.parse(probePlanSchema, input);
  return [
    "#!/bin/bash",
    "# No `set -e`: a failed request is a line of output, not the end of the probe.",
    "set -uo pipefail",
    `base='http://127.0.0.1:${spec.publicPort}'`,
    `run='${plan.runId}'`,
    "count=0",
    'body="$(mktemp)"',
    `for round in $(seq 1 ${plan.rounds}); do`,
    `  for cell in $(seq 1 ${plan.cells}); do`,
    "    count=$((count + 1))",
    '    : > "$body"',
    `    code="$(curl -s -o "$body" -w '%{http_code}' --max-time ${plan.requestTimeoutSeconds} "$base/?name=$run-$cell" || true)"`,
    '    # The counter answers {"n":<number>,...}. Anything else is not an acknowledgement.',
    '    n="$(sed -n \'s/^{"n":\\([0-9][0-9]*\\)[,}].*/\\1/p\' "$body" | head -n 1)"',
    '    echo "P $count $cell ${code:-000} ${n:--}"',
    "  done",
    `  sleep ${plan.pauseSeconds}`,
    "done",
    'rm -f "$body"',
    "# Without this line the output was cut off, and the ledger is not complete.",
    'echo "DONE $count"',
  ].join("\n");
}
// #endregion script

// #region parse
export type Attempt = { seq: number; cell: number; status: number; n: number | null };
export type ProbeOutput = { attempts: Attempt[]; complete: boolean; malformed: string[] };

const LINE = /^P (\d+) (\d+) (\d{3}) (\d+|-)$/;

/** Reads what the script printed. A line it does not understand is kept, never guessed at. */
export function parseProbeOutput(stdout: string): ProbeOutput {
  const attempts: Attempt[] = [];
  const malformed: string[] = [];
  let done: number | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    const match = LINE.exec(line);
    if (match !== null) {
      attempts.push({
        seq: Number(match[1]),
        cell: Number(match[2]),
        status: Number(match[3]),
        n: match[4] === "-" ? null : Number(match[4]),
      });
      continue;
    }
    const end = /^DONE (\d+)$/.exec(line);
    if (end !== null) {
      done = Number(end[1]);
      continue;
    }
    malformed.push(line);
  }
  return { attempts, complete: done !== null && done === attempts.length, malformed };
}
// #endregion parse
