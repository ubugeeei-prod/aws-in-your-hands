import { describe, expect, it } from "vite-plus/test";

import { diffTables, fenceVersions } from "../src/table-diff.ts";
import { createWorld, OWNER } from "./world.ts";

const edit = (expectedVersion: number, title: string) => ({ title, body: "", expectedVersion });

describe("diffTables", () => {
  it("lists what cutting over gives back and what it costs", async () => {
    const world = createWorld();
    const deleted = await world.createNote("deleted by mistake");
    await world.attach(deleted.id);
    const edited = await world.createNote("edited later");
    const point = world.tick();
    await world.deleteNote(deleted.id);
    await world.notes.update(OWNER, edited.id, edit(1, "edited"));
    const created = await world.createNote("created later");
    await world.attach(created.id);
    const restored = world.open(world.table.restoreTo(point), world.bucket);

    expect(diffTables(await world.snapshot(), await restored.snapshot())).toEqual({
      returning: [{ owner: OWNER, noteId: deleted.id }],
      lost: [{ owner: OWNER, noteId: created.id }],
      rolledBack: [{ owner: OWNER, noteId: edited.id, restoredVersion: 1, liveVersion: 2 }],
      attachmentsReturning: 1,
      attachmentsLost: 1,
    });
  });
});

describe("chapter 05's version check across a restore", () => {
  async function rolledBack() {
    const world = createWorld();
    const note = await world.createNote("plan");
    const point = world.tick();
    await world.notes.update(OWNER, note.id, edit(1, "second"));
    await world.notes.update(OWNER, note.id, edit(2, "third"));
    // A browser tab is showing version 3 when the table is restored to version 1.
    const staleTab = edit(3, "saved from the old tab");
    const restored = world.open(world.table.restoreTo(point), world.bucket);
    return { world, note, staleTab, restored };
  }

  it("lets a stale tab overwrite edits it never saw, once the numbers come round again", async () => {
    const { note, staleTab, restored } = await rolledBack();
    await restored.notes.update(OWNER, note.id, edit(1, "after the restore"));
    await restored.notes.update(OWNER, note.id, edit(2, "more work"));

    // Version 3 again, but a different version 3.
    expect(await restored.notes.update(OWNER, note.id, staleTab)).toMatchObject({
      status: "updated",
    });
    expect(await restored.notes.get(OWNER, note.id)).toMatchObject({
      title: "saved from the old tab",
    });
  });

  it("refuses the stale tab after the restored versions are raised past the live ones", async () => {
    const { world, note, staleTab, restored } = await rolledBack();
    const diff = diffTables(await world.snapshot(), await restored.snapshot());

    expect(await fenceVersions(restored.noteRepository, diff, { dryRun: false })).toEqual([
      { owner: OWNER, noteId: note.id, to: 4 },
    ]);
    await restored.notes.update(OWNER, note.id, edit(4, "after the restore"));
    await restored.notes.update(OWNER, note.id, edit(5, "more work"));

    expect(await restored.notes.update(OWNER, note.id, staleTab)).toMatchObject({
      status: "conflict",
    });
    expect(await restored.notes.get(OWNER, note.id)).toMatchObject({
      title: "more work",
      version: 6,
    });
  });

  it("raises a version once, and never lowers one", async () => {
    const { world, note, restored } = await rolledBack();
    const diff = diffTables(await world.snapshot(), await restored.snapshot());

    expect(await fenceVersions(restored.noteRepository, diff, { dryRun: true })).toHaveLength(1);
    expect(await restored.notes.get(OWNER, note.id)).toMatchObject({ version: 1 });

    await fenceVersions(restored.noteRepository, diff, { dryRun: false });
    await restored.notes.update(OWNER, note.id, edit(4, "edited after the fence"));
    await fenceVersions(restored.noteRepository, diff, { dryRun: false });

    expect(await restored.notes.get(OWNER, note.id)).toMatchObject({
      title: "edited after the fence",
      version: 5,
    });
    expect(await restored.noteRepository.raiseVersion(OWNER, "no-such-note", 9)).toBe("unchanged");
  });
});
