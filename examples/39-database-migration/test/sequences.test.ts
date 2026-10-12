import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { sqlStateOf } from "@aih/example-13-sql/src/db.ts";

import { applyChanges, fullLoad } from "../src/model/replicate.ts";
import { applySequences, planSequences } from "../src/sequences.ts";
import { compareTables } from "../src/verify.ts";
import { type World, scalar, seed, world, writer } from "./support.ts";

describe("sequences across the switch", () => {
  let w: World;
  beforeEach(async () => {
    w = await world();
    await seed(w.source);
    const progress = await fullLoad(w.source, w.target, w.pairs);
    await applyChanges(w.source, w.target, w.pairs, progress);
  });
  afterEach(() => w.close());

  it("collides on the first insert after the switch, although every count and digest matched", async () => {
    expect((await compareTables(w.source, w.target, w.pairs)).every((check) => check.match)).toBe(
      true,
    );
    // Rows with id 1 and 2 were copied. The target's sequence has never been asked.
    const collision = await writer(w.target, "app").revision(3, 1, "third").catch(sqlStateOf);
    expect(collision).toBe("23505");
  });

  it("continues after the source once the sequences are advanced", async () => {
    const plans = await planSequences(w.source, w.target, w.pairs);
    expect(plans.map((plan) => [plan.sequence, plan.setTo])).toEqual([
      ["app.note_revisions_id_seq", 2n],
      ["app.audit_log_id_seq", 1n],
    ]);
    await applySequences(w.target, plans);
    await applySequences(w.target, plans);

    await writer(w.target, "app").revision(3, 1, "third");
    expect(await scalar(w.target, "SELECT max(id)::integer FROM app.note_revisions")).toBe(3);
  });

  it("does not hand out again a number the source gave to a row that was later deleted", async () => {
    await writer(w.source).revision(3, 1, "third");
    await w.source.query("DELETE FROM public.note_revisions WHERE id = 3");
    const progress = { captureFrom: {}, checkpoint: 0 };
    await applyChanges(w.source, w.target, w.pairs, progress);

    const [plan] = await planSequences(w.source, w.target, w.pairs);
    // max(id) in the target is 2 again; the source's sequence remembers 3.
    expect(plan).toMatchObject({ targetHighest: 2n, sourceHandedOut: 3n, setTo: 3n });
  });

  it("leaves a gap on request, for a source that might still be writing", async () => {
    const [plan] = await planSequences(w.source, w.target, w.pairs, 1000n);
    expect(plan?.setTo).toBe(1002n);
  });
});
