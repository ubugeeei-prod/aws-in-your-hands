import * as v from "valibot";

import type { TableRef } from "./catalog.ts";

// #region schema
// `%` is any run of characters and `_` is any one. Bracket patterns are
// documented as unreliable across endpoint types, so this schema refuses them.
const pattern = v.pipe(v.string(), v.minLength(1), v.regex(/^[^[\]]+$/, "no bracket patterns"));
const ruleId = v.pipe(v.string(), v.regex(/^[1-9][0-9]*$/, "a numeric string"));
const ruleName = v.pipe(v.string(), v.regex(/^[A-Za-z0-9-]+$/, "alphanumeric"));

const selectionRule = v.strictObject({
  "rule-type": v.literal("selection"),
  "rule-id": ruleId,
  "rule-name": ruleName,
  "object-locator": v.strictObject({ "schema-name": pattern, "table-name": pattern }),
  "rule-action": v.picklist(["include", "exclude"]),
});

const renameSchemaRule = v.strictObject({
  "rule-type": v.literal("transformation"),
  "rule-id": ruleId,
  "rule-name": ruleName,
  "rule-target": v.literal("schema"),
  "object-locator": v.strictObject({ "schema-name": pattern }),
  "rule-action": v.literal("rename"),
  value: v.pipe(v.string(), v.regex(/^[a-z_][a-z0-9_]*$/, "a lower-case identifier")),
});

const distinct = (values: string[]): boolean => new Set(values).size === values.length;

/** Exactly the rules this chapter writes. Every other rule type DMS accepts is refused here. */
export const tableMappingsSchema = v.pipe(
  v.strictObject({
    rules: v.array(v.variant("rule-type", [selectionRule, renameSchemaRule])),
  }),
  v.check(({ rules }) => distinct(rules.map((rule) => rule["rule-id"])), "rule-id must be unique"),
  v.check(
    ({ rules }) => distinct(rules.map((rule) => rule["rule-name"])),
    "rule-name must be unique",
  ),
  v.check(
    ({ rules }) =>
      rules.some((rule) => rule["rule-type"] === "selection" && rule["rule-action"] === "include"),
    "at least one selection rule must include something",
  ),
);

export type TableMappings = v.InferOutput<typeof tableMappingsSchema>;
// #endregion schema

// #region rules
export const tableMappings: TableMappings = v.parse(tableMappingsSchema, {
  rules: [
    {
      "rule-type": "selection",
      "rule-id": "1",
      "rule-name": "every-table-in-public",
      "object-locator": { "schema-name": "public", "table-name": "%" },
      "rule-action": "include",
    },
    {
      // The target keeps its own record of the migrations applied to it.
      "rule-type": "selection",
      "rule-id": "2",
      "rule-name": "not-the-migration-bookkeeping",
      "object-locator": { "schema-name": "public", "table-name": "aih_migrations" },
      "rule-action": "exclude",
    },
    {
      "rule-type": "transformation",
      "rule-id": "3",
      "rule-name": "public-becomes-app",
      "rule-target": "schema",
      "object-locator": { "schema-name": "public" },
      "rule-action": "rename",
      value: "app",
    },
  ],
});
// #endregion rules

function matches(wildcard: string, name: string): boolean {
  const source = [...wildcard]
    .map((character) =>
      character === "%"
        ? ".*"
        : character === "_"
          ? "."
          : character.replaceAll(/[\\^$.*+?()|{}]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${source}$`, "s").test(name);
}

export type Resolution = {
  /** Tables that will be copied, with where each one lands. */
  selected: { source: TableRef; target: TableRef }[];
  /** Matched by an include rule and then by an exclude rule. */
  excluded: TableRef[];
  /** Matched by no include rule: left behind without anyone having said so. */
  unmatched: TableRef[];
};

// #region resolve
/**
 * This chapter's reading of the documented rules, for the rule types above
 * only: a table is copied when an include rule matches it and no exclude rule
 * does, and a schema rename applies to every selected table of that schema.
 */
export function resolveMappings(mappings: TableMappings, tables: TableRef[]): Resolution {
  const resolution: Resolution = { selected: [], excluded: [], unmatched: [] };
  const selections = mappings.rules.filter((rule) => rule["rule-type"] === "selection");
  const renames = mappings.rules.filter((rule) => rule["rule-type"] === "transformation");

  for (const table of tables) {
    const hit = (action: "include" | "exclude"): boolean =>
      selections.some(
        (rule) =>
          rule["rule-action"] === action &&
          matches(rule["object-locator"]["schema-name"], table.schema) &&
          matches(rule["object-locator"]["table-name"], table.name),
      );
    if (!hit("include")) {
      resolution.unmatched.push(table);
    } else if (hit("exclude")) {
      resolution.excluded.push(table);
    } else {
      const rename = renames.find((rule) =>
        matches(rule["object-locator"]["schema-name"], table.schema),
      );
      resolution.selected.push({
        source: table,
        target: { schema: rename?.value ?? table.schema, name: table.name },
      });
    }
  }
  return resolution;
}
// #endregion resolve
