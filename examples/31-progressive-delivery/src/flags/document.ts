import * as v from "valibot";

// The format AppConfig stores for a profile of type AWS.AppConfig.FeatureFlags, as far as
// this chapter uses it. Anything else in the file is refused here, before AppConfig sees it.

// #region document
const key = v.pipe(v.string(), v.regex(/^[a-z][a-zA-Z\d_-]{0,63}$/));
const label = v.pipe(v.string(), v.regex(/^[^\n]{1,64}$/));
const description = v.pipe(v.string(), v.maxLength(1024));

const constraints = v.variant("type", [
  v.strictObject({
    type: v.literal("number"),
    required: v.optional(v.boolean()),
    minimum: v.optional(v.pipe(v.number(), v.integer())),
    maximum: v.optional(v.pipe(v.number(), v.integer())),
  }),
  v.strictObject({ type: v.literal("boolean"), required: v.optional(v.boolean()) }),
  v.strictObject({
    type: v.literal("string"),
    required: v.optional(v.boolean()),
    enum: v.optional(v.array(v.pipe(v.string(), v.maxLength(1024)))),
  }),
]);

const attributeValue = v.union([
  v.pipe(v.string(), v.maxLength(1024)),
  v.pipe(v.number(), v.finite()),
  v.boolean(),
]);

// v.record takes an array for an object, and leaves out three key names without a word.
// A flag file is a map, and a flag it was handed must not go missing.
const DROPPED = ["__proto__", "prototype", "constructor"];
const map = v.custom<Record<string, unknown>>(
  (input) =>
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    !DROPPED.some((name) => Object.hasOwn(input, name)),
  "Must be an object, with no key named __proto__, prototype, or constructor.",
);

export const flagDocumentSchema = v.strictObject({
  version: v.literal("1"),
  flags: v.pipe(
    map,
    v.record(
      key,
      v.strictObject({
        name: v.optional(label),
        description: v.optional(description),
        attributes: v.optional(
          v.pipe(
            map,
            v.record(key, v.strictObject({ description: v.optional(description), constraints })),
          ),
          {},
        ),
      }),
    ),
  ),
  values: v.pipe(
    map,
    v.record(key, v.pipe(map, v.objectWithRest({ enabled: v.boolean() }, attributeValue))),
  ),
});
export type FlagDocument = v.InferOutput<typeof flagDocumentSchema>;
// #endregion document

// #region check
/**
 * What the schema cannot say: that values match their definitions, and that the file
 * and the code agree on which flags exist. An empty list means the file may be deployed.
 */
export function checkDocument(document: FlagDocument, knownFlags: readonly string[]): string[] {
  const problems: string[] = [];
  const defined = Object.keys(document.flags);
  for (const name of knownFlags) {
    if (!defined.includes(name)) {
      problems.push(`${name}: the code reads this flag, and the file does not define it`);
    }
  }
  for (const name of Object.keys(document.values)) {
    if (!defined.includes(name)) {
      problems.push(`${name}: has a value and no definition`);
    }
  }
  for (const [name, flag] of Object.entries(document.flags)) {
    if (!knownFlags.includes(name)) {
      // A flag nobody reads is a switch connected to nothing. Someone will flip it in an incident.
      problems.push(`${name}: defined, and no code reads it`);
    }
    const value = document.values[name];
    if (value === undefined) {
      problems.push(`${name}: has no value`);
      continue;
    }
    const { enabled: _enabled, ...attributes } = value;
    for (const attribute of Object.keys(attributes)) {
      if (flag.attributes[attribute] === undefined) {
        problems.push(`${name}.${attribute}: has a value and no definition`);
      }
    }
    for (const [attribute, { constraints: rule }] of Object.entries(flag.attributes)) {
      const actual = attributes[attribute];
      const at = `${name}.${attribute}`;
      if (actual === undefined) {
        if (rule.required === true) {
          problems.push(`${at}: required, and missing`);
        }
        continue;
      }
      if (typeof actual !== rule.type) {
        problems.push(`${at}: must be a ${rule.type}, got ${JSON.stringify(actual)}`);
        continue;
      }
      if (rule.type === "number" && typeof actual === "number") {
        if (rule.minimum !== undefined && actual < rule.minimum) {
          problems.push(`${at}: ${actual} is below the minimum ${rule.minimum}`);
        }
        if (rule.maximum !== undefined && actual > rule.maximum) {
          problems.push(`${at}: ${actual} is above the maximum ${rule.maximum}`);
        }
      }
      if (
        rule.type === "string" &&
        rule.enum !== undefined &&
        !rule.enum.includes(String(actual))
      ) {
        problems.push(`${at}: ${JSON.stringify(actual)} is not one of ${rule.enum.join(", ")}`);
      }
    }
  }
  return problems;
}
// #endregion check

// #region retrieved
type Retrieved = Record<string, { enabled: boolean } & Record<string, string | number | boolean>>;

/**
 * What an application receives for this document. AppConfig drops the definitions,
 * and it drops the attributes of a flag that is off.
 */
export function toRetrieved(document: FlagDocument): Retrieved {
  return Object.fromEntries(
    Object.entries(document.values).map(([name, value]) => [
      name,
      value.enabled ? value : { enabled: false },
    ]),
  );
}
// #endregion retrieved

export function parseDocument(text: string, knownFlags: readonly string[]): FlagDocument {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error("The flag file is not JSON.", { cause: error });
  }
  const result = v.safeParse(flagDocumentSchema, json);
  const problems = result.success
    ? checkDocument(result.output, knownFlags)
    : result.issues.map((issue) => `${v.getDotPath(issue) ?? ""}: ${issue.message}`);
  if (!result.success || problems.length > 0) {
    throw new Error(`The flag file is not valid:\n  ${problems.join("\n  ")}`);
  }
  return result.output;
}
