import * as v from "valibot";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { readCatalog } from "../src/catalog.ts";
import { resolveMappings, tableMappings, tableMappingsSchema } from "../src/table-mappings.ts";
import { type World, world } from "./support.ts";

const rule = (override: Record<string, unknown>) => ({
  "rule-type": "selection",
  "rule-id": "1",
  "rule-name": "a",
  "object-locator": { "schema-name": "public", "table-name": "%" },
  "rule-action": "include",
  ...override,
});

describe("the table-mapping schema", () => {
  it("accepts the rules of this chapter", () => {
    expect(v.safeParse(tableMappingsSchema, structuredClone(tableMappings)).success).toBe(true);
  });

  it("refuses a rule type the chapter does not use, and a misspelled key", () => {
    const tableSettings = { rules: [rule({}), { "rule-type": "table-settings", "rule-id": "2" }] };
    expect(v.safeParse(tableMappingsSchema, tableSettings).success).toBe(false);
    const misspelled = { rules: [rule({ rule_action: "include" })] };
    expect(v.safeParse(tableMappingsSchema, misspelled).success).toBe(false);
  });

  it("refuses duplicate rule IDs, bracket patterns, and a mapping that includes nothing", () => {
    const twice = { rules: [rule({}), rule({ "rule-name": "b" })] };
    expect(v.safeParse(tableMappingsSchema, twice).success).toBe(false);
    const bracket = {
      rules: [rule({ "object-locator": { "schema-name": "public", "table-name": "note[s]" } })],
    };
    expect(v.safeParse(tableMappingsSchema, bracket).success).toBe(false);
    const onlyExclude = { rules: [rule({ "rule-action": "exclude" })] };
    expect(v.safeParse(tableMappingsSchema, onlyExclude).success).toBe(false);
  });
});

describe("the rules against the real schemas", () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });
  afterAll(() => w.close());

  it("decides every table of the source: four copied, the bookkeeping left, none forgotten", () => {
    const resolution = resolveMappings(tableMappings, w.catalog);
    expect(resolution.selected.map((pair) => pair.source.name).toSorted()).toEqual([
      "audit_log",
      "note_revisions",
      "notes",
      "owners",
    ]);
    expect(resolution.excluded.map((table) => table.name)).toEqual(["aih_migrations"]);
    expect(resolution.unmatched).toEqual([]);
  });

  it("lands every copied table on a target table with the same columns in the same order", async () => {
    const targets = await readCatalog(w.target, ["app"]);
    for (const pair of w.pairs) {
      const target = targets.find((table) => table.name === pair.target.name);
      expect(pair.target.schema).toBe("app");
      expect(target?.columns.map((column) => column.name)).toEqual(
        pair.source.columns.map((column) => column.name),
      );
      expect(target?.primaryKey).toEqual(pair.source.primaryKey);
    }
  });

  it("reports a table that no include rule matches instead of dropping it silently", () => {
    const elsewhere = [
      ...w.catalog,
      { schema: "reporting", name: "daily", columns: [], primaryKey: [] },
    ];
    expect(resolveMappings(tableMappings, elsewhere).unmatched).toEqual([
      expect.objectContaining({ schema: "reporting", name: "daily" }),
    ]);
  });

  it("treats _ as any one character, so an exclude can take a table it was not written for", () => {
    const lookalike = [{ schema: "public", name: "aihXmigrations" }];
    expect(resolveMappings(tableMappings, lookalike).excluded).toEqual(lookalike);
  });
});
