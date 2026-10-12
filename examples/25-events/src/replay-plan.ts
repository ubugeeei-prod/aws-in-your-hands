import * as v from "valibot";

import { ARCHIVE_RETENTION_DAYS } from "./routes.ts";

// #region plan
const RULE_NAMES = ["timeline", "counter", "rejections"] as const;
export type ReplayRule = (typeof RULE_NAMES)[number];

const argsSchema = v.object({
  /** How far back to start, in minutes before now. Command-line text: "60" becomes 60. */
  minutes: v.pipe(v.string(), v.transform(Number), v.number(), v.safeInteger(), v.minValue(1)),
  rule: v.optional(v.array(v.picklist(RULE_NAMES)), []),
  name: v.optional(v.pipe(v.string(), v.regex(/^[.\-_A-Za-z0-9]{1,64}$/))),
});

export type ReplayPlan = {
  name: string;
  from: Date;
  to: Date;
  /** Empty means every rule on the bus. */
  rules: ReplayRule[];
  warnings: string[];
};

/**
 * Decides what a replay covers before anything is asked of AWS. Refuses a
 * window the archive cannot hold, and says what the replay will not do.
 */
export function planReplay(input: unknown, now: Date): ReplayPlan {
  const args = v.parse(argsSchema, input);
  if (args.minutes > ARCHIVE_RETENTION_DAYS * 24 * 60) {
    throw new Error(
      `The archive keeps ${ARCHIVE_RETENTION_DAYS} days. Nothing older can be replayed.`,
    );
  }
  const rules = [...new Set(args.rule)];
  const warnings: string[] = [];
  if (args.minutes < 10) {
    // EventBridge's own advice: an event can take a while to reach the archive.
    warnings.push("Events of the last 10 minutes may not be in the archive yet.");
  }
  if (rules.length === 0 || rules.includes("rejections")) {
    warnings.push(
      "The rejections rule does not match replayed events: no notice is sent again by this replay.",
    );
  }
  return {
    name:
      args.name ??
      `replay-${now
        .toISOString()
        .replaceAll(/[^0-9]/g, "")
        .slice(0, 14)}`,
    from: new Date(now.getTime() - args.minutes * 60_000),
    to: now,
    rules,
    warnings,
  };
}
// #endregion plan
