import * as v from "valibot";

import { jsonEntries } from "./json-object.ts";

// A small model of how identity policies and SCPs combine, for testing policy
// files before anyone attaches them. It is not IAM: it knows two condition keys
// and four operators, and it refuses anything else instead of guessing.

const list = v.pipe(
  v.union([v.string(), v.array(v.string())]),
  v.transform((value) => [value].flat()),
);
// jsonEntries: `Condition: []` is not "no condition", and no operator or key is skipped.
const conditionSchema = jsonEntries(jsonEntries(list));

export const statementSchema = v.pipe(
  v.strictObject({
    Sid: v.optional(v.string()),
    Effect: v.picklist(["Allow", "Deny"]),
    Action: v.optional(list),
    NotAction: v.optional(list),
    Resource: list,
    Condition: v.optional(conditionSchema),
  }),
  v.check(
    (statement) => (statement.Action === undefined) !== (statement.NotAction === undefined),
    "exactly one of Action and NotAction",
  ),
);
export type Statement = v.InferOutput<typeof statementSchema>;

// strictObject: a Principal or NotPrincipal element, which SCPs do not support, fails the parse.
export const policySchema = v.strictObject({
  Version: v.literal("2012-10-17"),
  Statement: v.array(statementSchema),
});
export type Policy = v.InferOutput<typeof policySchema>;

export type Request = { action: string; region: string; principalArn: string };
export type Decision = "allow" | "explicit-deny" | "implicit-deny";

/** IAM's `*` and `?` wildcards. Actions compare case-insensitively. */
export function wildcardMatch(pattern: string, value: string, caseInsensitive = false): boolean {
  const body = pattern
    .replaceAll(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${body}$`, caseInsensitive ? "i" : "").test(value);
}

const KEYS: Record<string, (request: Request) => string> = {
  "aws:RequestedRegion": (request) => request.region,
  "aws:PrincipalArn": (request) => request.principalArn,
};

const OPERATORS: Record<string, (value: string, expected: string[]) => boolean> = {
  StringEquals: (value, expected) => expected.includes(value),
  StringNotEquals: (value, expected) => !expected.includes(value),
  ArnLike: (value, expected) => expected.some((pattern) => wildcardMatch(pattern, value)),
  ArnNotLike: (value, expected) => !expected.some((pattern) => wildcardMatch(pattern, value)),
};

function conditionHolds(condition: Statement["Condition"], request: Request): boolean {
  return (condition ?? []).every(([operator, keys]) =>
    keys.every(([key, expected]) => {
      // Object.hasOwn: `OPERATORS["constructor"]` would find Object's, and call it.
      const test = Object.hasOwn(OPERATORS, operator) ? OPERATORS[operator] : undefined;
      const read = Object.hasOwn(KEYS, key) ? KEYS[key] : undefined;
      if (test === undefined || read === undefined) {
        throw new Error(`the model does not know ${operator} on ${key}`);
      }
      return test(read(request), expected);
    }),
  );
}

function applies(statement: Statement, request: Request): boolean {
  const named = (statement.Action ?? statement.NotAction ?? []).some((pattern) =>
    wildcardMatch(pattern, request.action, true),
  );
  const actionMatches = statement.Action === undefined ? !named : named;
  return actionMatches && conditionHolds(statement.Condition, request);
}

const has = (policies: Policy[], effect: Statement["Effect"], request: Request): boolean =>
  policies.some((policy) =>
    policy.Statement.some(
      (statement) => statement.Effect === effect && applies(statement, request),
    ),
  );

// #region decide
/**
 * `scpLevels`: the SCPs attached at the root, at each OU on the way down, and at the account.
 * An explicit Deny anywhere wins. Otherwise the identity policy and every level must each allow.
 */
export function decide(request: Request, identity: Policy[], scpLevels: Policy[][]): Decision {
  if (has([...identity, ...scpLevels.flat()], "Deny", request)) {
    return "explicit-deny";
  }
  const everyLevelAllows = scpLevels.every((level) => has(level, "Allow", request));
  return everyLevelAllows && has(identity, "Allow", request) ? "allow" : "implicit-deny";
}
// #endregion decide

/** What Organizations attaches everywhere when SCPs are turned on. */
export const FULL_AWS_ACCESS: Policy = {
  Version: "2012-10-17",
  Statement: [{ Effect: "Allow", Action: ["*"], Resource: ["*"] }],
};
