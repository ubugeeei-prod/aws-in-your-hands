// vp run recovery:demo
//
// The whole drill in memory: an accident, a table restored to one point, a
// bucket left at another, the check, the repair, the check again. No AWS,
// no credentials, nothing written to disk.

import { KEY_PREFIX } from "@aih/example-07-uploads/api/src/keys.ts";

import { SEVERITY } from "../src/invariants.ts";
import { createWorld, HTML, OWNER } from "../src/local.ts";
import { restoreObjects } from "../src/object-restore.ts";
import { diffTables, fenceVersions } from "../src/table-diff.ts";

const world = createWorld();
const say = (line: string) => console.log(line);
const time = (date: Date) => date.toISOString().slice(11, 19);

// #region demo
const trip = await world.createNote("trip to Kyoto");
await world.attach(trip.id);
const recipe = await world.createNote("ramen recipe");
const recipeImage = await world.attach(recipe.id);
const point = world.tick();
say(`${time(point)}  two notes, one inspected image each. This is the point to return to.`);

await world.notes.update(OWNER, recipe.id, {
  title: "ramen recipe, improved",
  body: "",
  expectedVersion: 1,
});
world.tick();
await world.deleteNote(trip.id);
await world.overwrite(recipeImage.key, HTML);
const diary = await world.createNote("diary, written after the point");
say(
  `${time(world.now())}  since then: one edit, one note deleted by mistake, one image overwritten, one new note.`,
);

// Point-in-time recovery: a new table as of `point`. The bucket is not touched.
const restored = world.open(world.table.restoreTo(point), world.bucket);
say(`\nrestored the table to ${time(point)}. The bucket is still at ${time(world.now())}.`);

const diff = diffTables(await world.snapshot(), await restored.snapshot());
say(
  `cutting over gives back ${diff.returning.length} note, loses ${diff.lost.length}, undoes edits to ${diff.rolledBack.length}.`,
);

const report = async (title: string) => {
  const { findings } = await restored.report();
  say(`\n${title}: ${findings.length} findings`);
  for (const finding of findings) {
    say(
      `  ${SEVERITY[finding.kind].padEnd(8)} ${finding.kind}  ${"key" in finding ? finding.key : ""}`,
    );
  }
};
await report("check: the restored table against the bucket as it is");

// The bucket goes back to the same point: markers come off, old bytes are copied on top.
const plan = await restoreObjects(world.bucket, { prefix: KEY_PREFIX, point, dryRun: false });
say(`\nrestored the bucket to ${time(point)}: ${plan.steps.map((step) => step.type).join(", ")}`);
await report("check again");

// What is still wrong after both restores is what the repair is for. Here: nothing.
const repaired = await restored.repairAll();
say(
  `\nrepair: ${repaired.repaired.length} actions, ${repaired.left.length} findings left for a person`,
);

const fences = await fenceVersions(restored.noteRepository, diff, { dryRun: false });
say(
  `raised the version of ${fences.length} rolled-back note past the number the live table had reached.`,
);
// #endregion demo

say(
  `\nnot restored, and not found by any check: "${diary.title}". It exists only in the old table.`,
);
