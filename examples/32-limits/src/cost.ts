import * as v from "valibot";

// #region tags
// On every resource of the stack. Billing reads a tag only after its key has been
// activated as a cost allocation tag, by hand, once per account.
export const COST_TAGS = { project: "aih-notes", chapter: "32-limits" } as const;

export const PROJECT_TAG_KEY = "project";
// #endregion tags

// #region period
const day = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * This month up to yesterday, in UTC. `End` is exclusive, and today is still being counted.
 * On the 1st that leaves nothing, and Start would equal End: the month before is asked for.
 */
export function monthToDate(today: Date): { Start: string; End: string } {
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  if (today.getUTCDate() === 1) {
    return { Start: day(new Date(Date.UTC(year, month - 1, 1))), End: day(today) };
  }
  return { Start: day(new Date(Date.UTC(year, month, 1))), End: day(today) };
}
// #endregion period

// #region args
/** Arguments for `aws ce get-cost-and-usage`. Every run of it is billed as one request. */
export function costByTagArgs(period: { Start: string; End: string }, tagKey: string): string[] {
  return [
    "ce",
    "get-cost-and-usage",
    "--time-period",
    `Start=${period.Start},End=${period.End}`,
    "--granularity",
    "MONTHLY",
    "--metrics",
    "UnblendedCost",
    "--group-by",
    `Type=TAG,Key=${tagKey}`,
    "Type=DIMENSION,Key=SERVICE",
  ];
}
// #endregion args

// #region response
const amountSchema = v.object({
  // A decimal as text. It stays text until it is shown.
  Amount: v.pipe(v.string(), v.regex(/^-?\d+(\.\d+)?(E-?\d+)?$/i)),
  Unit: v.string(),
});

export const costAndUsageSchema = v.object({
  ResultsByTime: v.array(
    v.object({
      TimePeriod: v.object({ Start: v.string(), End: v.string() }),
      Estimated: v.optional(v.boolean(), false),
      Groups: v.optional(
        v.array(
          v.object({
            Keys: v.array(v.string()),
            Metrics: v.object({ UnblendedCost: amountSchema }),
          }),
        ),
        [],
      ),
    }),
  ),
  NextPageToken: v.optional(v.string()),
});

export type CostAndUsage = v.InferOutput<typeof costAndUsageSchema>;
// #endregion response

// #region breakdown
export type CostRow = { tagValue: string | undefined; service: string; usd: number };

export type Breakdown = {
  rows: CostRow[];
  taggedUsd: number;
  /** Cost that carries no value for the tag: resources without it, and charges no tag reaches. */
  untaggedUsd: number;
};

/** A tag group's key is `key$value`; with no value, `key$`. */
export function tagValueOf(groupKey: string, tagKey: string): string | undefined {
  const prefix = `${tagKey}$`;
  if (!groupKey.startsWith(prefix)) {
    throw new Error(`"${groupKey}" is not a group of the tag "${tagKey}"`);
  }
  const value = groupKey.slice(prefix.length);
  return value === "" ? undefined : value;
}

export function breakdown(response: CostAndUsage, tagKey: string): Breakdown {
  const rows = response.ResultsByTime.flatMap((result) =>
    result.Groups.map((group): CostRow => {
      const [tagGroup = "", service = ""] = group.Keys;
      return {
        tagValue: tagValueOf(tagGroup, tagKey),
        service,
        usd: Number(group.Metrics.UnblendedCost.Amount),
      };
    }),
  ).toSorted((a, b) => b.usd - a.usd);
  const total = (wanted: boolean) =>
    rows
      .filter((row) => (row.tagValue !== undefined) === wanted)
      .reduce((sum, row) => sum + row.usd, 0);
  return { rows, taggedUsd: total(true), untaggedUsd: total(false) };
}
// #endregion breakdown
