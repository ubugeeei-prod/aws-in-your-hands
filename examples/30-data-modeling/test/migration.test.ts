import { describe, expect, it } from "vite-plus/test";

import { attachmentSk, INDEX_SK, legacyAttachmentSk, noteSk, ownerPk } from "../src/keys.ts";
import { PHASES, type Phase } from "../src/layout.ts";
import type { MemoryTable } from "../src/memory-table.ts";
import { backfill, planBackfill, removeLegacy, verify } from "../src/migration.ts";
import { createNotebook } from "../src/notebook.ts";
import { at, attachment, change, memoryTable, note } from "./support.ts";

const OWNER = "u1";
const pk = ownerPk(OWNER);

/** A table as chapters 05, 07 and 08 left it: no index attributes, attachments under their old keys. */
async function legacyTable(): Promise<MemoryTable> {
  const table = memoryTable();
  for (const id of ["n1", "n2"]) {
    const { tags: _, ...stored } = note(id, { updatedAt: at(id === "n1" ? 1 : 2) });
    await table.write({ kind: "put", item: { pk, sk: noteSk(id), ...stored } });
  }
  for (const id of ["a1", "a2"]) {
    await table.write({
      kind: "put",
      item: { pk, sk: legacyAttachmentSk("n1", id), ...attachment("n1", id) },
    });
  }
  await table.write({ kind: "put", item: { pk, sk: "QUOTA", noteCount: 2 } });
  await table.write({ kind: "put", item: { pk, sk: "INSPECTION#n1#a1", status: "clean" } });
  return table;
}

const attachments = async (table: MemoryTable, phase: Phase, noteId = "n1") =>
  (await createNotebook({ table, phase }).getWithAttachments(OWNER, noteId))?.attachments.map(
    (item) => item.id,
  );

describe("moving the attachment keys", () => {
  it("each phase reads what the phase before it and the phase after it write", async () => {
    for (const [index, phase] of PHASES.entries()) {
      const neighbours = [PHASES[index - 1], PHASES[index + 1]].filter(
        (other) => other !== undefined,
      );
      for (const writer of neighbours) {
        const table = memoryTable();
        await createNotebook({ table, phase: writer }).create(OWNER, note("n1"));
        await createNotebook({ table, phase: writer }).attach(OWNER, attachment("n1", "a1"));
        expect(await attachments(table, phase), `${writer} writes, ${phase} reads`).toEqual(["a1"]);
      }
    }
  });

  it("skipping a phase loses attachments: the last phase cannot read what the first wrote", async () => {
    const table = memoryTable();
    await createNotebook({ table, phase: "legacy" }).create(OWNER, note("n1"));
    await createNotebook({ table, phase: "legacy" }).attach(OWNER, attachment("n1", "a1"));
    expect(await attachments(table, "new")).toEqual([]);
  });

  it("reading the new keys before the backfill misses what was stored earlier, and verify says so", async () => {
    const table = await legacyTable();
    expect(await attachments(table, "dual-read-new")).toEqual([]);
    expect(await verify(table)).toEqual([
      { pk, sk: attachmentSk("n1", "a1") },
      { pk, sk: attachmentSk("n1", "a2") },
      { pk, sk: noteSk("n1") },
      { pk, sk: noteSk("n2") },
    ]);

    await backfill(table, { pageSize: 10 });
    expect(await verify(table)).toEqual([]);
    expect(await attachments(table, "dual-read-new")).toEqual(["a1", "a2"]);
  });

  it("brings old notes into the recent list", async () => {
    const table = await legacyTable();
    const notebook = createNotebook({ table });
    expect((await notebook.listRecent(OWNER, { limit: 10 })).notes).toEqual([]);

    await backfill(table, { pageSize: 10 });
    expect((await notebook.listRecent(OWNER, { limit: 10 })).notes.map((item) => item.id)).toEqual([
      "n2",
      "n1",
    ]);
  });

  it("a dry run reports the same work and writes nothing", async () => {
    const table = await legacyTable();
    const before = table.items();
    expect(await backfill(table, { pageSize: 10, dryRun: true })).toMatchObject({
      scanned: 6,
      written: 4,
    });
    expect(table.items()).toEqual(before);
  });

  it("run twice, the second run writes nothing", async () => {
    const table = await legacyTable();
    expect(await backfill(table, { pageSize: 10 })).toMatchObject({ written: 4, skipped: 0 });
    const after = table.items();
    // The two old attachment items are still there. Their copies exist, so the put is refused.
    expect(await backfill(table, { pageSize: 10 })).toMatchObject({ written: 0, skipped: 2 });
    expect(table.items()).toEqual(after);
  });

  it("stopped after any page, it resumes from the saved key and ends in the same state", async () => {
    const whole = await legacyTable();
    await backfill(whole, { pageSize: 10 });

    const table = await legacyTable();
    let next: { pk: string; sk: string } | undefined;
    let runs = 0;
    do {
      // One page per run, as if the process were killed after each.
      ({ next } = await backfill(table, { pageSize: 2, maxPages: 1, after: next }));
      runs++;
    } while (next !== undefined);
    expect(runs).toBeGreaterThan(2);
    expect(table.items()).toEqual(whole.items());
  });

  it("does not overwrite a note the app saved after the scan read it", async () => {
    const table = await legacyTable();
    const scanned = (await table.get({ pk, sk: noteSk("n1") })) ?? { pk, sk: "" };
    const writes = planBackfill(scanned);

    // Between the scan and the write, the app saves the note. That update writes the index key itself.
    await createNotebook({ table }).update(OWNER, "n1", change(1, { minute: 40 }));
    const saved = await table.get({ pk, sk: noteSk("n1") });

    const [write] = writes;
    expect(write?.kind).toBe("update");
    if (write?.kind === "update") {
      expect(await table.write(write)).toBe("condition_failed");
    }
    expect(await table.get({ pk, sk: noteSk("n1") })).toEqual(saved);
    expect(saved?.[INDEX_SK]).toContain(at(40));
  });

  it("does not bring back an attachment that was deleted after the scan read it", async () => {
    const table = await legacyTable();
    const scanned = (await table.get({ pk, sk: legacyAttachmentSk("n1", "a1") })) ?? { pk, sk: "" };
    const writes = planBackfill(scanned);

    await createNotebook({ table, phase: "dual-write" }).detach(OWNER, "n1", "a1");

    expect(await table.transact(writes)).toEqual({
      ok: false,
      reasons: ["condition_failed", "none"],
    });
    expect(await table.get({ pk, sk: attachmentSk("n1", "a1") })).toBeUndefined();
  });

  it("removes an old key only where the new one exists", async () => {
    const table = await legacyTable();
    await backfill(table, { pageSize: 10 });
    // One copy goes missing, as it would if this step ran before the backfill finished.
    await table.write({ kind: "delete", key: { pk, sk: attachmentSk("n1", "a2") } });

    expect(await removeLegacy(table, { pageSize: 10, dryRun: true })).toEqual({
      removed: 1,
      kept: 1,
    });
    expect(await removeLegacy(table, { pageSize: 10 })).toEqual({ removed: 1, kept: 1 });
    expect(await table.get({ pk, sk: legacyAttachmentSk("n1", "a1") })).toBeUndefined();
    expect(await table.get({ pk, sk: legacyAttachmentSk("n1", "a2") })).toBeDefined();
  });

  it("leaves items it does not know alone", async () => {
    const table = await legacyTable();
    await backfill(table, { pageSize: 10 });
    await removeLegacy(table, { pageSize: 10 });
    expect(await table.get({ pk, sk: "INSPECTION#n1#a1" })).toEqual({
      pk,
      sk: "INSPECTION#n1#a1",
      status: "clean",
    });
    expect(await table.get({ pk, sk: "QUOTA" })).toMatchObject({ noteCount: 2 });
  });
});
