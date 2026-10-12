import * as v from "valibot";

import type { LintException } from "@aih/example-21-security/src/iam-lint.ts";

import { RULE_IDS, type RuleId, RULES } from "./rules/rule.ts";
import { readTemplate } from "./template.ts";

export type Finding = { rule: RuleId; resource: string; detail: string };

// #region waiver
/** One finding a person looked at and decided to keep, and why. */
export const waiverSchema = v.pipe(
  v.strictObject({
    rule: v.picklist(RULE_IDS),
    /** A logical ID. Left out: any resource of the stack. */
    resource: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9]+$/))),
    /** The finding's detail, exactly. Left out: any detail. */
    detail: v.optional(v.pipe(v.string(), v.minLength(1))),
    reason: v.pipe(v.string(), v.trim(), v.minLength(20)),
  }),
  // Neither would switch a whole rule off for the stack.
  v.check(
    (waiver) => waiver.resource !== undefined || waiver.detail !== undefined,
    "a waiver names a resource, a detail, or both",
  ),
);
export type Waiver = v.InferOutput<typeof waiverSchema>;

const covers = (waiver: Waiver, finding: Finding): boolean =>
  waiver.rule === finding.rule &&
  (waiver.resource === undefined || waiver.resource === finding.resource) &&
  (waiver.detail === undefined || waiver.detail === finding.detail);
// #endregion waiver

// #region iam-exceptions
/** Chapter 21 keeps its reasoned exceptions per action. Here each becomes a waiver. */
export const fromIamExceptions = (exceptions: LintException[]): Waiver[] =>
  exceptions.map((exception) => ({
    rule: "iam-wildcard",
    detail: `wildcard-resource: ${exception.action} on Resource "*"`,
    reason: exception.reason,
  }));
// #endregion iam-exceptions

export type CheckResult = {
  findings: Finding[];
  waived: { finding: Finding; reason: string }[];
  unusedWaivers: Waiver[];
};

// #region check
/** Runs every rule over one synthesized template. Reads JSON and nothing else. */
export function checkTemplate(input: unknown, waivers: Waiver[] = []): CheckResult {
  const template = readTemplate(input);
  const accepted = v.parse(v.array(waiverSchema), waivers);
  const used = new Set<Waiver>();
  const result: CheckResult = { findings: [], waived: [], unusedWaivers: [] };

  for (const rule of RULE_IDS) {
    for (const problem of RULES[rule].check(template)) {
      const finding = { rule, ...problem };
      const waiver = accepted.find((candidate) => covers(candidate, finding));
      if (waiver === undefined) {
        result.findings.push(finding);
      } else {
        used.add(waiver);
        result.waived.push({ finding, reason: waiver.reason });
      }
    }
  }
  // A waiver nothing needs any more would hide the next finding of its kind.
  result.unusedWaivers = accepted.filter((waiver) => !used.has(waiver));
  return result;
}
// #endregion check

/** Does this stack pass as a gate? Unused waivers fail it too. */
export const passes = (result: CheckResult): boolean =>
  result.findings.length === 0 && result.unusedWaivers.length === 0;
