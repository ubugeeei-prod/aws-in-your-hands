import { type CheckResult, passes } from "./check.ts";
import { RULE_IDS, type RuleId, RULES } from "./rules/rule.ts";

export type StackResult = { stack: string; gated: boolean; result: CheckResult };

// #region verdict
export type Verdict = {
  /** Stacks asked to pass that did not, and gates that matched no template. */
  failedGates: string[];
  findings: number;
  waived: number;
  byRule: Record<RuleId, number>;
};

export function verdict(stacks: StackResult[], gates: string[]): Verdict {
  const byRule = Object.fromEntries(RULE_IDS.map((rule) => [rule, 0])) as Record<RuleId, number>;
  for (const { result } of stacks) {
    for (const finding of result.findings) {
      byRule[finding.rule] += 1;
    }
  }
  const seen = new Set(stacks.map((entry) => entry.stack));
  return {
    failedGates: [
      // A gate that read nothing has not passed.
      ...gates.filter((name) => !seen.has(name)),
      ...stacks.filter((entry) => entry.gated && !passes(entry.result)).map((entry) => entry.stack),
    ],
    findings: stacks.reduce((sum, entry) => sum + entry.result.findings.length, 0),
    waived: stacks.reduce((sum, entry) => sum + entry.result.waived.length, 0),
    byRule,
  };
}
// #endregion verdict

// #region render
/** The report as lines of text. Reported stacks are listed with their findings; only gated ones can fail. */
export function render(stacks: StackResult[], gates: string[]): string[] {
  const lines: string[] = [];
  for (const { stack, gated, result } of stacks) {
    const clean = passes(result);
    const mark = clean ? "ok  " : gated ? "FAIL" : "note";
    const waived =
      result.waived.length > 0 ? ` (${result.waived.length} waived with a reason)` : "";
    lines.push(`${mark} ${stack}${gated ? " [gate]" : ""}${waived}`);
    for (const finding of result.findings) {
      lines.push(`       ${finding.rule.padEnd(18)} ${finding.resource}: ${finding.detail}`);
    }
    for (const waiver of result.unusedWaivers) {
      lines.push(
        `       waiver for ${waiver.rule} ${waiver.resource ?? waiver.detail} matches nothing; delete it`,
      );
    }
  }

  const summary = verdict(stacks, gates);
  lines.push("", "findings by rule (chapter that does the work):");
  for (const rule of RULE_IDS) {
    lines.push(
      `  ${String(summary.byRule[rule]).padStart(3)}  ${rule.padEnd(18)} ch.${RULES[rule].chapter}  ${RULES[rule].breaks}`,
    );
  }
  lines.push(
    "",
    `${stacks.length} templates, ${summary.findings} findings, ${summary.waived} waived`,
  );
  for (const name of gates.filter((gate) => !stacks.some((entry) => entry.stack === gate))) {
    lines.push(`FAIL gate ${name}: no such template was read`);
  }
  return lines;
}
// #endregion render
