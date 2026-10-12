import { describe, expect, it } from "vite-plus/test";

import { MAX_TAGS_PER_NOTE } from "../src/model.ts";
import { planAttach, planCreate, planRemove, planUpdate } from "../src/plan.ts";
import { MAX_TRANSACTION_ITEMS, type Write } from "../src/table.ts";
import { attachment, note } from "./support.ts";

const target = (write: Write): string => (write.kind === "put" ? write.item.sk : write.key.sk);
const shape = (planned: { write: Write }[]): string[] =>
  planned.map(({ write }) => `${write.kind} ${target(write)}`);

describe("plans", () => {
  it("create: note, counter, slug, then one item per tag", () => {
    const planned = planCreate("u1", note("n1", { tags: ["a", "b"], slug: "s" }), 100);
    expect(shape(planned)).toEqual([
      "put NOTE#n1",
      "update QUOTA",
      "put SLUG#s",
      "put TAG#a#NOTE#n1",
      "put TAG#b#NOTE#n1",
    ]);
    expect(planned.map((entry) => entry.refusal)).toEqual([
      "already_exists",
      "quota_exceeded",
      "slug_taken",
      undefined,
      undefined,
    ]);
  });

  it("the largest note still fits one transaction many times over", () => {
    const tags = Array.from({ length: MAX_TAGS_PER_NOTE }, (_, index) => `t${index}`);
    const full = note("n1", { tags, slug: "s" });
    const renamed = { ...note("n1", { slug: "other", title: "renamed" }), version: 2 };
    for (const planned of [
      planCreate("u1", full, 100),
      planRemove("u1", full),
      // Every tag removed, the title and the slug changed.
      planUpdate("u1", full, renamed),
    ]) {
      expect(planned.length).toBeLessThanOrEqual(MAX_TAGS_PER_NOTE + 3);
      expect(planned.length).toBeLessThan(MAX_TRANSACTION_ITEMS);
      // DynamoDB refuses a transaction that names an item twice.
      expect(new Set(planned.map((entry) => target(entry.write))).size).toBe(planned.length);
    }
  });

  it("update: only the note when title, tags and slug stay", () => {
    const current = note("n1", { tags: ["a"], slug: "s" });
    expect(shape(planUpdate("u1", current, { ...current, body: "more", version: 2 }))).toEqual([
      "update NOTE#n1",
    ]);
  });

  it("update: deletes what was removed, puts what was added, leaves the rest", () => {
    const current = note("n1", { tags: ["keep", "drop"], slug: "old" });
    const next = { ...current, tags: ["keep", "add"], slug: "new", version: 2 };
    expect(shape(planUpdate("u1", current, next))).toEqual([
      "update NOTE#n1",
      "delete TAG#drop#NOTE#n1",
      "put TAG#add#NOTE#n1",
      "delete SLUG#old",
      "put SLUG#new",
    ]);
  });

  it("update: removes the slug attribute when the note gives its slug up", () => {
    const current = note("n1", { slug: "old" });
    const { slug: _, ...without } = current;
    const [first] = planUpdate("u1", current, { ...without, version: 2 });
    expect(first?.write).toMatchObject({ kind: "update", remove: ["slug"] });
  });

  it("update: is conditional on the version it was planned from", () => {
    const current = { ...note("n1"), version: 7 };
    const [first] = planUpdate("u1", current, { ...current, version: 8 });
    expect(first).toMatchObject({
      write: { condition: { kind: "equals", attribute: "version", value: 7 } },
      refusal: "stale",
    });
  });

  it("attach: checks the note and refuses to overwrite, under every key in use", () => {
    const planned = planAttach("u1", attachment("n1", "a1"), ["legacy", "new"]);
    expect(shape(planned)).toEqual([
      "check NOTE#n1",
      "put ATTACHMENT#n1#a1",
      "put NOTE#n1#ATTACHMENT#a1",
    ]);
    expect(planned.map((entry) => entry.write.condition?.kind)).toEqual([
      "exists",
      "not_exists",
      "not_exists",
    ]);
  });
});
