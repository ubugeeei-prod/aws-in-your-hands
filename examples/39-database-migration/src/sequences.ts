import * as v from "valibot";

import { type Queryable, rows } from "@aih/example-13-sql/src/db.ts";

import { type Table, type TableRef, qualified, quote } from "./catalog.ts";

// bigint arrives as a number from PGlite and as a string from node-postgres.
const big = v.pipe(
  v.union([v.string(), v.number()]),
  v.transform((value) => String(value)),
  v.regex(/^-?[0-9]+$/),
  v.transform((value) => BigInt(value)),
);

const sequenceName = v.object({ name: v.nullable(v.string()) });
const sequenceState = v.object({ last_value: big, is_called: v.boolean() });
const highest = v.object({ highest: big });

// #region plan
export type SequencePlan = {
  /** The target's sequence, as `pg_get_serial_sequence` names it. */
  sequence: string;
  table: string;
  column: string;
  /** The highest value the source's sequence ever handed out, used or not. */
  sourceHandedOut: bigint;
  /** The highest value present in the target's column. */
  targetHighest: bigint;
  /** What the target's sequence is set to: the next insert gets the value after it. */
  setTo: bigint;
};

/**
 * For every sequence-fed column that was migrated: where the target's sequence
 * must stand so that it neither collides with a copied row nor hands out a
 * number the source already gave away. `headroom` is added on top, for a
 * source that may still be writing while this is read.
 */
export async function planSequences(
  source: Queryable,
  target: Queryable,
  pairs: { source: Table; target: TableRef }[],
  headroom = 0n,
): Promise<SequencePlan[]> {
  const plans: SequencePlan[] = [];
  for (const pair of pairs) {
    for (const column of pair.source.columns.filter((c) => c.generated)) {
      const nameOf = async (connection: Queryable, table: TableRef): Promise<string | null> =>
        (
          await rows(connection, sequenceName, "SELECT pg_get_serial_sequence($1, $2) AS name", [
            qualified(table),
            column.name,
          ])
        )[0]?.name ?? null;
      const sourceSequence = await nameOf(source, pair.source);
      const targetSequence = await nameOf(target, pair.target);
      if (sourceSequence === null || targetSequence === null) {
        throw new Error(`${pair.source.name}.${column.name} is fed by a sequence on one side only`);
      }
      // The names come from pg_get_serial_sequence, already quoted where needed.
      const [state] = await rows(
        source,
        sequenceState,
        `SELECT last_value, is_called FROM ${sourceSequence}`,
      );
      const [present] = await rows(
        target,
        highest,
        `SELECT coalesce(max(${quote(column.name)}), 0) AS highest FROM ${qualified(pair.target)}`,
      );
      const sourceHandedOut = state?.is_called === true ? state.last_value : 0n;
      const targetHighest = present?.highest ?? 0n;
      const floor = sourceHandedOut > targetHighest ? sourceHandedOut : targetHighest;
      plans.push({
        sequence: targetSequence,
        table: `${pair.target.schema}.${pair.target.name}`,
        column: column.name,
        sourceHandedOut,
        targetHighest,
        setTo: floor + headroom,
      });
    }
  }
  return plans;
}
// #endregion plan

// #region apply
/** Moves each sequence. Setting the same value twice changes nothing. */
export async function applySequences(target: Queryable, plans: SequencePlan[]): Promise<void> {
  for (const plan of plans) {
    // setval refuses 0: a sequence nobody used keeps its start value.
    if (plan.setTo > 0n) {
      await target.query("SELECT setval($1::regclass, $2::bigint, true)", [
        plan.sequence,
        plan.setTo.toString(),
      ]);
    }
  }
}
// #endregion apply
