// These tests exercise this chapter's MODEL of full load plus change capture.
// They show why the documented rules exist. They do not show what AWS DMS does.

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { sqlStateOf } from "@aih/example-13-sql/src/db.ts";

import { applyChanges, fullLoad, pendingChanges } from "../src/model/replicate.ts";
import { compareTables } from "../src/verify.ts";
import { type World, noteId, scalar, seed, titles, world, writer } from "./support.ts";

let w: World;
afterEach(() => w.close());

const allMatch = async (): Promise<boolean> =>
  (await compareTables(w.source, w.target, w.pairs)).every((check) => check.match);

describe("the model, on the prepared schema", () => {
  beforeEach(async () => {
    w = await world();
    await seed(w.source);
  });

  it("carries a row that was changed and a row that was deleted while its table was being copied", async () => {
    const write = writer(w.source);
    const progress = await fullLoad(w.source, w.target, w.pairs, {
      // The copy has already read the old rows when these commit.
      afterRead: async (table) => {
        if (table.name === "notes") {
          await write.retitle(1, "first, edited");
          await write.remove(2);
          await write.note(4, "ada", "fourth");
        }
      },
    });
    // The copy alone is stale: it is the table as it was read.
    expect(await titles(w.target, "app")).toEqual(["first", "second", "third"]);
    expect(await allMatch()).toBe(false);

    const report = await applyChanges(w.source, w.target, w.pairs, progress);
    expect(report).toMatchObject({ applied: 3, insertConflicts: 0, missingRows: 0 });
    expect(await titles(w.target, "app")).toEqual(["first, edited", "third", "fourth"]);
    expect(await allMatch()).toBe(true);
  });

  it("copes with a change that is both in the copy and in the log", async () => {
    const write = writer(w.source);
    const progress = await fullLoad(w.source, w.target, w.pairs, {
      // Capture has begun, the rows are not read yet: these land in both.
      beforeRead: async (table) => {
        if (table.name === "notes") {
          await write.note(4, "ada", "fourth");
          await write.retitle(4, "fourth, edited");
          await write.remove(3);
        }
      },
    });
    const report = await applyChanges(w.source, w.target, w.pairs, progress);
    // The insert was already copied, and the delete finds nothing to delete.
    expect(report).toMatchObject({ applied: 3, insertConflicts: 1, missingRows: 1 });
    expect(await allMatch()).toBe(true);
  });

  it("ends in the same state when a resume applies part of the log a second time", async () => {
    const write = writer(w.source);
    const progress = await fullLoad(w.source, w.target, w.pairs);
    await write.note(4, "ada", "fourth");
    await write.retitle(4, "fourth, edited");
    await write.remove(4);
    await write.note(4, "ada", "fourth again");
    await write.retitle(1, "first, edited");
    await write.revision(1, 2, "first, edited");

    // Five changes reach the target, then the process dies before saving how far it got.
    await expect(
      applyChanges(w.source, w.target, w.pairs, progress, { checkpointEvery: 100, crashAfter: 5 }),
    ).rejects.toThrow("before recording its checkpoint");
    expect(progress.checkpoint).toBe(0);

    const resumed = await applyChanges(w.source, w.target, w.pairs, progress);
    expect(resumed.applied).toBe(6);
    expect(resumed.insertConflicts).toBeGreaterThan(0);
    expect(await allMatch()).toBe(true);
    expect(await pendingChanges(w.source, progress)).toBe(0);
  });

  it("needs the foreign keys quiet during the copy: a child table can arrive before its parent", async () => {
    const childFirst = w.pairs.toReversed();
    const progress = await fullLoad(w.source, w.target, childFirst);
    await applyChanges(w.source, w.target, w.pairs, progress);
    expect(await allMatch()).toBe(true);

    // The same insert with the constraint awake is refused.
    const refused = await w.target
      .query(
        "INSERT INTO app.notes (id, owner, title, body, version, created_at, updated_at) VALUES ($1, 'nobody', 't', '', 1, now(), now())",
        [noteId(9)],
      )
      .catch(sqlStateOf);
    expect(refused).toBe("23503");
  });

  it("loses a write made on the target when the replication is resumed after the switch", async () => {
    const progress = await fullLoad(w.source, w.target, w.pairs);
    await writer(w.source).retitle(1, "edited on the source");
    const beforeTheEdit = { ...progress };
    await applyChanges(w.source, w.target, w.pairs, progress);

    // The application now writes to the target, and that write is acknowledged.
    await writer(w.target, "app").retitle(1, "edited on the target");

    // Someone resumes the replication from an older checkpoint.
    await applyChanges(w.source, w.target, w.pairs, beforeTheEdit);
    expect((await titles(w.target, "app"))[0]).toBe("edited on the source");
  });

  it("loses a write the old database still accepted after the switch, unless it refuses writes", async () => {
    const progress = await fullLoad(w.source, w.target, w.pairs);
    await applyChanges(w.source, w.target, w.pairs, progress);
    // Switched: the replication is stopped and never reads the log again.

    // An instance that still holds the old connection string writes, and is told it worked.
    await writer(w.source).note(5, "ada", "written to the wrong database");
    expect(
      await scalar(w.target, `SELECT count(*)::integer FROM app.notes WHERE id = '${noteId(5)}'`),
    ).toBe(0);

    // With the source read-only, the same write fails and nothing was acknowledged.
    await w.source.query("SET default_transaction_read_only = on");
    const refused = await writer(w.source).note(6, "ada", "refused").catch(sqlStateOf);
    expect(refused).toBe("25006");
  });
});

describe("the model, on the schema as found", () => {
  beforeEach(async () => {
    w = await world({ prepared: false });
    await seed(w.source);
  });

  it("doubles the rows of a table without a primary key when part of the log is applied twice", async () => {
    const write = writer(w.source);
    const progress = await fullLoad(w.source, w.target, w.pairs);
    await write.audit("ada", "signed in");
    await write.audit("ada", "signed out");

    await expect(
      applyChanges(w.source, w.target, w.pairs, progress, { checkpointEvery: 100, crashAfter: 2 }),
    ).rejects.toThrow();
    await applyChanges(w.source, w.target, w.pairs, progress);

    const [audit] = (await compareTables(w.source, w.target, w.pairs)).filter(
      (check) => check.table === "app.audit_log",
    );
    expect(audit).toMatchObject({ sourceRows: 3, targetRows: 5, match: false });
  });

  it("cannot carry an update or a delete of a table without a primary key", async () => {
    const progress = await fullLoad(w.source, w.target, w.pairs);
    await w.source.query("UPDATE public.audit_log SET action = 'redacted'");
    await w.source.query("DELETE FROM public.audit_log");

    const report = await applyChanges(w.source, w.target, w.pairs, progress);
    expect(report.ignoredWithoutKey).toBe(2);
    expect(await scalar(w.target, "SELECT action FROM app.audit_log")).toBe("created 3 notes");
  });
});
