// A small evaluator for EventBridge event patterns, so that the patterns the
// stack deploys can be tried against events without AWS. It implements a
// subset and refuses the rest when the pattern is compiled:
//
//   exact values       "state": ["running", 1, true, null]
//   prefix, suffix     [{ "prefix": "NOTE#" }], [{ "suffix": ".png" }]
//   exists             [{ "exists": true }], [{ "exists": false }]
//   numeric            [{ "numeric": [">", 0, "<=", 5] }]
//
// Not implemented: $or, anything-but, equals-ignore-case, wildcard, cidr,
// and a field whose value in the event is an array.

export class UnsupportedPatternError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedPatternError";
  }
}

// #region compile
type Scalar = string | number | boolean | null;
type Test = (value: unknown, present: boolean) => boolean;
export type Matcher = (event: unknown) => boolean;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isScalar = (value: unknown): value is Scalar =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

const OPERATORS: Record<string, (left: number, right: number) => boolean> = {
  "<": (left, right) => left < right,
  "<=": (left, right) => left <= right,
  "=": (left, right) => left === right,
  ">": (left, right) => left > right,
  ">=": (left, right) => left >= right,
};

function numeric(spec: unknown, path: string): Test {
  if (!Array.isArray(spec) || (spec.length !== 2 && spec.length !== 4)) {
    throw new UnsupportedPatternError(`${path}: numeric takes one or two comparisons`);
  }
  const checks: ((value: number) => boolean)[] = [];
  for (let index = 0; index < spec.length; index += 2) {
    const compare = OPERATORS[String(spec[index])];
    const bound: unknown = spec[index + 1];
    if (compare === undefined || typeof bound !== "number") {
      throw new UnsupportedPatternError(`${path}: numeric comparison is not one this reads`);
    }
    checks.push((value) => compare(value, bound));
  }
  return (value) => typeof value === "number" && checks.every((check) => check(value));
}

/** One element of a field's array: a value to equal, or one operator. */
function alternative(spec: unknown, path: string): Test {
  if (isScalar(spec)) {
    // After JSON.parse, 300 and 300.0 are one number. EventBridge compares
    // how the number was written, so there they are two.
    return (value, present) => present && value === spec;
  }
  if (!isRecord(spec) || Object.keys(spec).length !== 1) {
    throw new UnsupportedPatternError(`${path}: expected a value or a single operator`);
  }
  const [[operator, operand] = ["", undefined]] = Object.entries(spec);
  if ((operator === "prefix" || operator === "suffix") && typeof operand === "string") {
    return operator === "prefix"
      ? (value) => typeof value === "string" && value.startsWith(operand)
      : (value) => typeof value === "string" && value.endsWith(operand);
  }
  if (operator === "exists" && typeof operand === "boolean") {
    // Only a leaf exists in this sense. An object in that place does not count.
    return (value, present) => (present && !isRecord(value)) === operand;
  }
  if (operator === "numeric") {
    return numeric(operand, path);
  }
  throw new UnsupportedPatternError(`${path}: operator "${operator}" is not implemented`);
}

/** Throws UnsupportedPatternError for anything outside the subset above. */
export function compile(pattern: unknown, path = "$"): Matcher {
  if (!isRecord(pattern)) {
    throw new UnsupportedPatternError(`${path}: a pattern is an object`);
  }
  const fields = Object.entries(pattern).map(([name, spec]): Matcher => {
    const here = `${path}.${name}`;
    if (name === "$or") {
      throw new UnsupportedPatternError(`${here}: $or is not implemented`);
    }
    if (isRecord(spec)) {
      // The same nesting in the event, or no match.
      const inner = compile(spec, here);
      return (event) => isRecord(event) && inner(event[name]);
    }
    if (!Array.isArray(spec) || spec.length === 0) {
      throw new UnsupportedPatternError(`${here}: expected a non-empty array or an object`);
    }
    const tests = spec.map((item) => alternative(item, here));
    return (event) => {
      const present = isRecord(event) && Object.hasOwn(event, name);
      const value = present ? event[name] : undefined;
      if (Array.isArray(value)) {
        throw new UnsupportedPatternError(`${here}: arrays in an event are not implemented`);
      }
      // Any one of the alternatives is enough.
      return tests.some((test) => test(value, present));
    };
  });
  // Every field the pattern names has to match; fields it does not name are ignored.
  return (event) => fields.every((field) => field(event));
}
// #endregion compile

export const matches = (pattern: unknown, event: unknown): boolean => compile(pattern)(event);
