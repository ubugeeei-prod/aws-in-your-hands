// The whole cutover on two in-memory databases, with this chapter's model in
// place of AWS DMS. Touches no network and no AWS.

import { PGlite } from "@electric-sql/pglite";

import type { Queryable } from "@aih/example-13-sql/src/db.ts";
import { sqlStateOf } from "@aih/example-13-sql/src/db.ts";

import { type Table, readCatalog } from "../src/catalog.ts";
import { maySwitch } from "../src/cutover.ts";
import { installCapture } from "../src/model/capture.ts";
import { applyChanges, fullLoad, pendingChanges } from "../src/model/replicate.ts";
import { preflight } from "../src/preflight.ts";
import { applySequences, planSequences } from "../src/sequences.ts";
import { runSqlDirectory } from "../src/sql-file.ts";
import { resolveMappings, tableMappings } from "../src/table-mappings.ts";
import { compareTables, missingSecondaryObjects } from "../src/verify.ts";

const open = async (): Promise<Queryable> => {
  const db = await PGlite.create();
  return {
    query: async (text, params) => ({ rows: (await db.query(text, [...(params ?? [])])).rows }),
  };
};
const say = (line: string): void => console.log(line);
const at = "2026-10-13T00:00:00.000Z";
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const source = await open();
const target = await open();
await runSqlDirectory(source, "source", (file) => file.startsWith("0001"));
await runSqlDirectory(target, "target");

await source.query("INSERT INTO public.owners VALUES ('ada', 2)");
for (const n of [1, 2]) {
  await source.query("INSERT INTO public.notes VALUES ($1, 'ada', $2, '', 1, $3, $3)", [
    id(n),
    `note ${n}`,
    at,
  ]);
  await source.query(
    "INSERT INTO public.note_revisions (note_id, version, title, saved_at) VALUES ($1, 1, $2, $3)",
    [id(n), `note ${n}`, at],
  );
}
await source.query("INSERT INTO public.audit_log VALUES ($1, 'ada', 'created 2 notes')", [at]);

const select = async (): Promise<{ source: Table; target: { schema: string; name: string } }[]> => {
  const catalog = await readCatalog(source, ["public"]);
  const resolution = resolveMappings(tableMappings, catalog);
  const order = ["owners", "notes", "note_revisions", "audit_log"];
  return resolution.selected
    .map((pair) => ({ source: pair.source as Table, target: pair.target }))
    .toSorted((a, b) => order.indexOf(a.source.name) - order.indexOf(b.source.name));
};

say("1. preflight, on the source as found");
for (const finding of preflight((await select()).map((pair) => pair.source))) {
  say(`   ${finding.severity.padEnd(7)} ${finding.table}: ${finding.code}`);
}

say("2. sql/source/0002_prepare.sql, then preflight again");
await runSqlDirectory(source, "source", (file) => file.startsWith("0002"));
const pairs = await select();
const blockers = preflight(pairs.map((pair) => pair.source)).filter(
  (finding) => finding.severity === "blocker",
);
say(`   blockers: ${blockers.length}`);

say("3. full load, while the application keeps writing (model, not AWS DMS)");
await installCapture(
  source,
  pairs.map((pair) => pair.source),
);
const progress = await fullLoad(source, target, pairs, {
  afterRead: async (table) => {
    if (table.name === "notes") {
      await source.query(
        "UPDATE public.notes SET title = 'note 1, edited', version = 2 WHERE id = $1",
        [id(1)],
      );
      await source.query("DELETE FROM public.notes WHERE id = $1", [id(2)]);
    }
  },
});
const show = async (): Promise<void> => {
  for (const check of await compareTables(source, target, pairs)) {
    say(
      `   ${check.table.padEnd(18)} source ${check.sourceRows}  target ${check.targetRows}  ${check.match ? "match" : "DIFFER"}`,
    );
  }
};
await show();
say(`   changes not applied yet: ${await pendingChanges(source, progress)}`);

say("4. apply the recorded changes");
const report = await applyChanges(source, target, pairs, progress);
say(
  `   applied ${report.applied}, insert conflicts ${report.insertConflicts}, missing rows ${report.missingRows}`,
);

say("5. stop writes on the source, then compare");
await source.query("SET default_transaction_read_only = on");
const late = await source
  .query("INSERT INTO public.owners VALUES ('late', 0)")
  .catch((error: unknown) => sqlStateOf(error));
say(`   a late write to the source: SQLSTATE ${String(late)}`);
await show();

say("6. the first insert on the target, before and after the sequences are advanced");
const insert = (): Promise<unknown> =>
  target
    .query(
      "INSERT INTO app.note_revisions (note_id, version, title, saved_at) VALUES ($1, 2, 'note 1, edited', $2) RETURNING id",
      [id(1), at],
    )
    .then((result) => `id ${String((result.rows[0] as { id: unknown }).id)}`)
    .catch((error: unknown) => `SQLSTATE ${String(sqlStateOf(error))}`);
say(`   before: ${String(await insert())}`);
const plans = await planSequences(source, target, pairs);
for (const plan of plans) {
  say(
    `   ${plan.sequence}: source handed out ${plan.sourceHandedOut}, target holds ${plan.targetHighest}, set to ${plan.setTo}`,
  );
}
const missing = await missingSecondaryObjects(
  { connection: source, schema: "public" },
  { connection: target, schema: "app" },
  pairs.map((pair) => pair.source.name),
);
const checks = await compareTables(source, target, pairs);
await applySequences(target, plans);

say("7. may we switch?");
const decision = maySwitch({
  // The model has no clock: no pending change stands in for a latency of 0.
  cdcLatencySourceSeconds: (await pendingChanges(source, progress)) === 0 ? 0 : null,
  cdcLatencyTargetSeconds: (await pendingChanges(source, progress)) === 0 ? 0 : null,
  sourceReadOnly: late === "25006",
  openWriteTransactions: 0,
  // The model validates nothing itself, so every table rests on the comparison.
  tables: checks.map((check) => ({
    name: check.table,
    validationState: "Not enabled" as const,
    comparedEqual: check.match,
  })),
  sequencesAdvanced: true,
  missingSecondaryObjects: missing,
  replicationStopped: true,
});
say(
  `   ${decision.ok ? "yes" : "no"}${decision.blockers.map((blocker) => `\n   - ${blocker}`).join("")}`,
);
say(`   after:  ${String(await insert())}`);
