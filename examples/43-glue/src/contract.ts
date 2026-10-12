import { COLUMNS } from "@aih/example-26-analytics/src/record.ts";

import { renderRuleset } from "./quality.ts";

// #region contract
// The catalog's type names on the left, Spark SQL's on the right.
const SPARK_TYPE = { int: "INT", bigint: "BIGINT", string: "STRING" } as const;

/** The columns as a Spark DDL string: what `spark.read.schema(...)` takes. */
export const sparkColumns = (): string =>
  COLUMNS.map(({ name, type }) => `${name} ${SPARK_TYPE[type]}`).join(", ");

const BEGIN = "# contract:begin";
const END = "# contract:end";

/** The lines of the script that are derived from TypeScript, and nothing else. */
export const contractBlock = (): string =>
  [
    `${BEGIN} (written by \`vp run glue:contract\`; a test fails when it is stale)`,
    `COLUMNS = "${sparkColumns()}"`,
    `RULESET = """${renderRuleset()}"""`,
    END,
  ].join("\n");

/** The script with that block brought up to date. Text outside the markers is not touched. */
export function withContract(script: string): string {
  const begin = script.indexOf(BEGIN);
  const end = script.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(`The script has no ${BEGIN} … ${END} block`);
  }
  return `${script.slice(0, begin)}${contractBlock()}${script.slice(end + END.length)}`;
}
// #endregion contract
