import { describe, expect, it } from "vite-plus/test";

import { broken } from "../src/invariants.ts";
import { restoreObjects } from "../src/object-restore.ts";
import { repair } from "../src/repair.ts";
import { createWorld, eTagOf, failingOn, HTML, OWNER, PNG } from "./world.ts";

const kinds = (findings: { kind: string }[]): string[] =>
  findings.map((finding) => finding.kind).toSorted();

/** Two notes with one inspected image each; then the first note is deleted by mistake. */
async function accident() {
  const world = createWorld();
  const trip = await world.createNote("trip");
  const tripImage = await world.attach(trip.id);
  const recipe = await world.createNote("recipe");
  const recipeImage = await world.attach(recipe.id);
  const beforeAccident = world.tick();
  await world.deleteNote(trip.id);
  return { world, trip, tripImage, recipe, recipeImage, beforeAccident };
}

describe("before any restore", () => {
  it("finds nothing after the accident: a clean delete is consistent, just wrong", async () => {
    const { world } = await accident();
    expect((await world.report()).findings).toEqual([]);
  });
});

describe("the table and the bucket restored to the same point", () => {
  it("brings the note, its record, and its image back with nothing to repair", async () => {
    const { world, trip, tripImage, beforeAccident } = await accident();
    const restored = world.open(world.table.restoreTo(beforeAccident), world.bucket);
    await restoreObjects(world.bucket, { prefix: "u/", point: beforeAccident, dryRun: false });

    expect(await restored.notes.get(OWNER, trip.id)).toMatchObject({ title: "trip" });
    expect(await world.bucket.head(tripImage.key)).toMatchObject({ size: PNG.byteLength });
    expect((await restored.report()).findings).toEqual([]);
  });
});

describe("only the table restored: records from before, a bucket from now", () => {
  it("finds the record whose object was deleted after the restore point", async () => {
    const { world, tripImage, beforeAccident } = await accident();
    const restored = world.open(world.table.restoreTo(beforeAccident), world.bucket);

    const report = await restored.report();
    expect(kinds(report.findings)).toEqual([
      "attachment_without_object",
      "inspection_without_object",
    ]);
    expect(broken(report)).toMatchObject([
      { kind: "attachment_without_object", key: tripImage.key },
    ]);
  });

  it("repairs by making the bucket follow the table, and keeps the inspection that is valid again", async () => {
    const { world, trip, tripImage, beforeAccident } = await accident();
    const restored = world.open(world.table.restoreTo(beforeAccident), world.bucket);

    const first = await restored.repairAll();
    expect(first.repaired).toEqual([
      { finding: "attachment_without_object", key: tripImage.key, action: "object_undeleted" },
      { finding: "inspection_without_object", key: tripImage.key, action: "nothing_to_do" },
    ]);
    expect((await restored.report()).findings).toEqual([]);
    expect(await restored.inspections.get(OWNER, trip.id, tripImage.attachmentId)).toMatchObject({
      verdict: "ok",
      eTag: eTagOf(PNG),
    });
  });

  it("changes nothing in a dry run, and reports what the real run does", async () => {
    const { world, beforeAccident } = await accident();
    const restored = world.open(world.table.restoreTo(beforeAccident), world.bucket);
    const before = await restored.snapshot();

    const planned = await restored.repairAll({ dryRun: true });
    expect(await restored.snapshot()).toEqual(before);
    expect((await restored.repairAll()).repaired).toEqual(planned.repaired);
  });

  it("ends in the same state when run twice from the same findings", async () => {
    const { world, beforeAccident } = await accident();
    const restored = world.open(world.table.restoreTo(beforeAccident), world.bucket);
    const stale = (await restored.report()).findings;

    await repair(restored.repairDeps(), stale, { dryRun: false });
    const once = await restored.snapshot();
    const again = await repair(restored.repairDeps(), stale, { dryRun: false });

    expect(await restored.snapshot()).toEqual(once);
    expect(again.repaired.map((item) => item.action)).toEqual(["nothing_to_do", "nothing_to_do"]);
  });

  it("is finished by a second run after stopping halfway", async () => {
    const world = createWorld();
    const first = await world.createNote("first");
    const second = await world.createNote("second");
    const images = [await world.attach(first.id), await world.attach(second.id)];
    const beforeAccident = world.tick();
    await world.deleteNote(first.id);
    await world.deleteNote(second.id);
    const restored = world.open(world.table.restoreTo(beforeAccident), world.bucket);

    const deps = { ...restored.repairDeps(), bucket: failingOn(world.bucket, "removeVersion", 2) };
    const findings = (await restored.report()).findings;
    await expect(repair(deps, findings, { dryRun: false })).rejects.toThrow("injected failure");
    expect(kinds((await restored.report()).findings)).toContain("attachment_without_object");

    await restored.repairAll();
    expect((await restored.report()).findings).toEqual([]);
    for (const image of images) {
      expect(await world.bucket.head(image.key)).toBeDefined();
    }
  });

  it("deletes the record, and says so, when no version of the object is left", async () => {
    const { world, tripImage, beforeAccident } = await accident();
    // What the lifecycle rule does 30 days after the delete.
    for await (const version of world.bucket.listVersions(tripImage.key)) {
      await world.bucket.removeVersion(version.key, version.versionId);
    }
    const restored = world.open(world.table.restoreTo(beforeAccident), world.bucket);

    const report = await restored.repairAll();
    expect(report.repaired).toEqual([
      { finding: "attachment_without_object", key: tripImage.key, action: "record_deleted" },
      { finding: "inspection_without_object", key: tripImage.key, action: "inspection_deleted" },
    ]);
    expect((await restored.report()).findings).toEqual([]);
  });
});

describe("the table restored to before an upload that the bucket still holds", () => {
  it("reports the image as an orphan and leaves it alone", async () => {
    const world = createWorld();
    const note = await world.createNote("trip");
    const beforeUpload = world.tick();
    const image = await world.attach(note.id);
    const restored = world.open(world.table.restoreTo(beforeUpload), world.bucket);

    const report = await restored.report();
    expect(report.findings).toEqual([{ kind: "object_without_record", key: image.key }]);
    expect(broken(report)).toEqual([]);
    expect((await restored.repairAll()).left).toEqual(report.findings);
    expect(await world.bucket.head(image.key)).toBeDefined();
  });

  it("is too young to judge while uploads may still be in flight", async () => {
    const world = createWorld();
    const note = await world.createNote("trip");
    const beforeUpload = world.tick();
    await world.attach(note.id);
    const restored = world.open(world.table.restoreTo(beforeUpload), world.bucket);

    expect(await restored.report(60 * 60_000)).toEqual({ findings: [], tooYoung: 1 });
  });

  it("loses the image to chapter 07's sweep, and gets it back from the versions", async () => {
    const world = createWorld();
    const note = await world.createNote("trip");
    const beforeUpload = world.tick();
    const image = await world.attach(note.id);
    const restored = world.open(world.table.restoreTo(beforeUpload), world.bucket);

    const beforeSweep = world.tick();
    expect((await restored.sweep({ dryRun: false })).removed).toEqual([
      { key: image.key, reason: "no_record" },
    ]);
    expect(await world.bucket.head(image.key)).toBeUndefined();

    const plan = await restoreObjects(world.bucket, {
      prefix: "u/",
      point: beforeSweep,
      dryRun: false,
    });
    expect(plan.steps).toMatchObject([{ type: "remove_delete_marker", key: image.key }]);
    expect(await world.bucket.head(image.key)).toMatchObject({ size: PNG.byteLength });
  });
});

describe("the bytes under a key changed after the restore point", () => {
  async function overwritten() {
    const world = createWorld();
    const note = await world.createNote("trip");
    const image = await world.attach(note.id);
    const beforeOverwrite = world.tick();
    await world.overwrite(image.key, HTML);
    const restored = world.open(world.table.restoreTo(beforeOverwrite), world.bucket);
    return { world, note, image, beforeOverwrite, restored };
  }

  it("finds a verdict that is about bytes no longer there", async () => {
    const { restored, image } = await overwritten();
    const report = await restored.report();
    expect(kinds(report.findings)).toEqual([
      "attachment_size_mismatch",
      "inspection_for_other_bytes",
    ]);
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        key: image.key,
        recordedETag: eTagOf(PNG),
        storedETag: eTagOf(HTML),
      }),
    );
  });

  it("inspects the bytes that are there now, and leaves the size mismatch to a person", async () => {
    const { restored, note, image } = await overwritten();
    const stale = await restored.inspections.get(OWNER, note.id, image.attachmentId);

    const report = await restored.repairAll();
    expect(report.repaired).toEqual([
      { finding: "inspection_for_other_bytes", key: image.key, action: "reinspected" },
    ]);
    expect(report.left).toMatchObject([{ kind: "attachment_size_mismatch" }]);

    const fresh = await restored.inspections.get(OWNER, note.id, image.attachmentId);
    expect(fresh).toMatchObject({
      verdict: "rejected",
      reason: "not_an_image",
      eTag: eTagOf(HTML),
    });
    expect((fresh?.sequencer ?? "") > (stale?.sequencer ?? "z")).toBe(true);
    expect(kinds((await restored.report()).findings)).toEqual(["attachment_size_mismatch"]);
  });

  it("does not let the repair's record block a real event that arrives late", async () => {
    const { world, restored, note, image } = await overwritten();
    await restored.repairAll();
    const repaired = await restored.inspections.get(OWNER, note.id, image.attachmentId);

    // A later upload, and its event, as S3 would number it.
    world.bucket.put(image.key, PNG, "image/png");
    await restored.inspect(image.key, PNG);

    const latest = await restored.inspections.get(OWNER, note.id, image.attachmentId);
    expect(latest).toMatchObject({ verdict: "ok", eTag: eTagOf(PNG) });
    expect((latest?.sequencer ?? "") > (repaired?.sequencer ?? "z")).toBe(true);
  });

  it("is also undone by restoring the bucket to the same point", async () => {
    const { world, restored, image, beforeOverwrite } = await overwritten();

    const plan = await restoreObjects(world.bucket, {
      prefix: "u/",
      point: beforeOverwrite,
      dryRun: false,
    });
    expect(plan.steps).toMatchObject([{ type: "copy_version", key: image.key }]);
    expect((await restored.report()).findings).toEqual([]);
  });
});

describe("chapter 08's open paths: an inspection whose object is gone", () => {
  async function leftover() {
    const world = createWorld();
    const note = await world.createNote("trip");
    const image = await world.attach(note.id);
    // The attachment is removed properly, but the delete event never reaches the worker.
    await world.attachmentService.remove(OWNER, note.id, image.attachmentId);
    world.tick();
    return { world, note, image };
  }

  it("is found without any restore having happened", async () => {
    const { world, image } = await leftover();
    const report = await world.report();
    expect(report.findings).toMatchObject([{ kind: "inspection_without_object", key: image.key }]);
    expect(broken(report)).toEqual([]);
  });

  it("is removed, once", async () => {
    const { world, note, image } = await leftover();
    expect((await world.repairAll()).repaired).toEqual([
      { finding: "inspection_without_object", key: image.key, action: "inspection_deleted" },
    ]);
    expect(await world.inspections.get(OWNER, note.id, image.attachmentId)).toBeUndefined();
    expect((await world.repairAll()).repaired).toEqual([]);
  });

  it("does not remove a record that a newer event wrote after the check", async () => {
    const { world, note, image } = await leftover();
    const stale = (await world.report()).findings;

    // Between the check and the repair: a new object under the key, inspected, and deleted again.
    world.bucket.put(image.key, PNG, "image/png");
    await world.inspect(image.key, PNG);
    await world.bucket.delete(image.key);
    const newer = await world.inspections.get(OWNER, note.id, image.attachmentId);

    await repair(world.repairDeps(), stale, { dryRun: false });
    expect(await world.inspections.get(OWNER, note.id, image.attachmentId)).toEqual(newer);
  });
});
