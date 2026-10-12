import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { applyChanges, fullLoad } from "../src/model/replicate.ts";
import { compareTables, missingSecondaryObjects } from "../src/verify.ts";
import { type World, seed, world, writer } from "./support.ts";

describe("verification by counts and digests", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await seed(w.source);
    const progress = await fullLoad(w.source, w.target, w.pairs);
    await applyChanges(w.source, w.target, w.pairs, progress);
  });
  afterEach(() => w.close());

  const notes = async () =>
    (await compareTables(w.source, w.target, w.pairs)).find((check) => check.table === "app.notes");

  it("sees a value that differs where the counts agree, such as a truncated body", async () => {
    await w.source.query("UPDATE public.notes SET body = repeat('x', 9000)");
    await w.target.query("UPDATE app.notes SET body = repeat('x', 8000)");
    expect(await notes()).toMatchObject({ sourceRows: 3, targetRows: 3, match: false });
  });

  it("reports a difference that is only a write in flight, so writes have to stop first", async () => {
    await writer(w.source).note(7, "ada", "committed between the two reads");
    expect(await notes()).toMatchObject({ sourceRows: 4, targetRows: 3, match: false });
  });

  it("does not see a missing index or constraint: rows match on a target that lacks them", async () => {
    await w.target.query("DROP INDEX app.notes_owner_created_idx");
    await w.target.query("ALTER TABLE app.notes DROP CONSTRAINT notes_owner_fkey");
    expect((await compareTables(w.source, w.target, w.pairs)).every((check) => check.match)).toBe(
      true,
    );

    const missing = await missingSecondaryObjects(
      { connection: w.source, schema: "public" },
      { connection: w.target, schema: "app" },
      w.pairs.map((pair) => pair.source.name),
    );
    expect(missing).toEqual([
      "foreign key notes.notes_owner_fkey",
      "index notes.notes_owner_created_idx",
    ]);
  });

  it("finds nothing missing on the target schema this chapter ships", async () => {
    const missing = await missingSecondaryObjects(
      { connection: w.source, schema: "public" },
      { connection: w.target, schema: "app" },
      w.pairs.map((pair) => pair.source.name),
    );
    expect(missing).toEqual([]);
  });
});
