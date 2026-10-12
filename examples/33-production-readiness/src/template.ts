import * as v from "valibot";

import { jsonEntries, jsonObject } from "@aih/example-21-security/src/json-object.ts";

// #region template
export type Resource = {
  id: string;
  type: string;
  properties: Record<string, unknown>;
  deletionPolicy: unknown;
  updateReplacePolicy: unknown;
};

export type Template = {
  resources: Resource[];
  /** The JSON as it was read, for a rule that brings its own reader. */
  raw: unknown;
};

const templateSchema = v.pipe(
  jsonObject,
  v.looseObject({
    // Required: `{}` is not a template, and a check that read nothing has not passed.
    Resources: jsonEntries(
      v.pipe(
        jsonObject,
        v.looseObject({
          Type: v.string(),
          Properties: v.optional(jsonObject),
          DeletionPolicy: v.optional(v.unknown()),
          UpdateReplacePolicy: v.optional(v.unknown()),
        }),
      ),
    ),
  }),
);

/** Reads synthesized CloudFormation JSON. Throws on anything that is not a template. */
export function readTemplate(input: unknown): Template {
  const resources = v.parse(templateSchema, input).Resources.map(([id, resource]) => ({
    id,
    type: resource.Type,
    properties: resource.Properties ?? {},
    deletionPolicy: resource.DeletionPolicy,
    updateReplacePolicy: resource.UpdateReplacePolicy,
  }));
  return { resources, raw: input };
}
// #endregion template

export const ofType = (template: Template, ...types: string[]): Resource[] =>
  template.resources.filter((resource) => types.includes(resource.type));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `value.a.b`, or undefined as soon as a step is not an object. */
export function at(value: unknown, ...path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

// #region references
const SUB_VARIABLE = /\$\{([A-Za-z0-9]+)(?:\.[A-Za-z0-9.]+)?\}/g;

/**
 * Logical IDs a value points at through Ref, Fn::GetAtt and Fn::Sub. The names of
 * parameters and pseudo parameters come back too: callers match against resources.
 */
export function references(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!isRecord(node)) {
      return;
    }
    for (const [key, inner] of Object.entries(node)) {
      if (key === "Ref" && typeof inner === "string") {
        found.add(inner);
      } else if (key === "Fn::GetAtt") {
        // Both spellings: ["Id", "Attr"] and "Id.Attr".
        const id = Array.isArray(inner) ? inner[0] : inner;
        if (typeof id === "string") {
          found.add(id.split(".")[0] ?? id);
        }
      } else if (key === "Fn::Sub") {
        const text = Array.isArray(inner) ? inner[0] : inner;
        if (typeof text === "string") {
          for (const match of text.matchAll(SUB_VARIABLE)) {
            found.add(match[1] ?? "");
          }
        }
        visit(Array.isArray(inner) ? inner[1] : undefined);
      } else {
        visit(inner);
      }
    }
  };
  visit(value);
  return [...found];
}
// #endregion references

// #region setting
/** What a template says about one setting. An intrinsic is decided at deploy time, not here. */
export type Setting = "absent" | "intrinsic" | { value: boolean | number | string };

export function setting(value: unknown): Setting {
  if (value === undefined || value === null) {
    return "absent";
  }
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return { value };
  }
  return "intrinsic";
}

export const isSetTo = (value: unknown, expected: boolean | number | string): boolean => {
  const read = setting(value);
  return typeof read === "object" && read.value === expected;
};
// #endregion setting
