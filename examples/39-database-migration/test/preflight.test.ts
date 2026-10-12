import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { preflight } from "../src/preflight.ts";
import { type World, world } from "./support.ts";

describe("preflight", () => {
  let found: World;
  let prepared: World;
  beforeAll(async () => {
    found = await world({ prepared: false });
    prepared = await world();
  });
  afterAll(async () => {
    await found.close();
    await prepared.close();
  });

  const blockers = (w: World) =>
    preflight(w.pairs.map((pair) => pair.source))
      .filter((finding) => finding.severity === "blocker")
      .map((finding) => `${finding.table}: ${finding.code}`);

  it("stops on the schema as found: a text primary key, and a table with no key", () => {
    expect(blockers(found)).toEqual([
      "public.owners: lob-primary-key",
      "public.audit_log: no-primary-key",
    ]);
  });

  it("has no blocker left after sql/source/0002_prepare.sql", () => {
    expect(blockers(prepared)).toEqual([]);
  });

  it("still names what the cutover must handle: LOB columns and sequences", () => {
    const notes = preflight(prepared.pairs.map((pair) => pair.source))
      .filter((finding) => finding.severity === "note")
      .map((finding) => `${finding.table}: ${finding.code}`);
    expect(notes).toEqual([
      "public.notes: lob-column",
      "public.note_revisions: lob-column",
      "public.note_revisions: sequence",
      "public.audit_log: lob-column",
      "public.audit_log: sequence",
    ]);
  });

  it("flags a varchar key without a usable length for data validation", () => {
    const table = {
      schema: "public",
      name: "tags",
      primaryKey: ["tag"],
      columns: [{ name: "tag", type: "character varying", maxLength: null, generated: false }],
    };
    expect(preflight([table]).map((finding) => finding.code)).toEqual([
      "unbounded-key-for-validation",
    ]);
  });
});
