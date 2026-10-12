// The part of a CloudFormation template this chapter reads. Everything else passes through unread.

import * as v from "valibot";

const resourceSchema = v.looseObject({
  Type: v.pipe(v.string(), v.minLength(1)),
  DependsOn: v.optional(v.union([v.string(), v.array(v.string())])),
});

// #region schema
export const templateSchema = v.looseObject({
  Resources: v.record(v.string(), resourceSchema),
  Parameters: v.optional(v.record(v.string(), v.unknown())),
  Outputs: v.optional(v.record(v.string(), v.unknown())),
});

export type Template = v.InferOutput<typeof templateSchema>;
// #endregion schema

/** Reads the JSON text of a template. YAML is not read: cdk.out holds JSON. */
export function parseTemplate(text: string): Template {
  return v.parse(templateSchema, JSON.parse(text));
}
