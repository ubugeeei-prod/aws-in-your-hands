import * as v from "valibot";

import { jsonEntries, jsonObject } from "./json-object.ts";

// #region exception
/** One action that may keep `Resource: "*"`, and why. A reason is not optional. */
export const exceptionSchema = v.object({
  action: v.pipe(v.string(), v.regex(/^[a-z0-9-]+:[A-Za-z0-9]+$/, "one exact action, no wildcard")),
  reason: v.pipe(v.string(), v.minLength(20)),
});
export type LintException = v.InferOutput<typeof exceptionSchema>;
// #endregion exception

export type FindingKind =
  | "wildcard-action"
  | "wildcard-resource"
  | "not-action"
  | "not-resource"
  | "broad-managed-policy"
  | "open-trust"
  | "unreadable";

export type Finding = { resource: string; kind: FindingKind; detail: string };
export type LintResult = { findings: Finding[]; unusedExceptions: LintException[] };

const stringOrList = v.pipe(
  v.union([v.string(), v.array(v.string())]),
  v.transform((value) => [value].flat()),
);
const statementSchema = v.looseObject({
  Effect: v.picklist(["Allow", "Deny"]),
  Action: v.optional(stringOrList),
  NotAction: v.optional(v.unknown()),
  // ARNs are often intrinsics (Fn::Join, Fn::GetAtt), so only the shape "one or many" is checked here.
  Resource: v.optional(v.unknown()),
  NotResource: v.optional(v.unknown()),
  Principal: v.optional(v.unknown()),
  Condition: v.optional(v.unknown()),
});
const documentSchema = v.looseObject({
  Statement: v.pipe(
    v.union([statementSchema, v.array(statementSchema)]),
    v.transform((value) => [value].flat()),
  ),
});
// jsonObject and jsonEntries: an array is not a template, and no logical ID is skipped.
const templateSchema = v.pipe(
  jsonObject,
  v.looseObject({
    Resources: v.optional(
      jsonEntries(v.looseObject({ Type: v.string(), Properties: v.optional(v.unknown()) })),
      {},
    ),
  }),
);

const BROAD_MANAGED =
  /:policy\/(AdministratorAccess|PowerUserAccess|IAMFullAccess|[A-Za-z0-9]*FullAccess)$/;

/** Types whose `Policies` are inline identity policies, and types that are one policy document. */
const WITH_INLINE = ["AWS::IAM::Role", "AWS::IAM::User", "AWS::IAM::Group"];
const ONE_DOCUMENT = ["AWS::IAM::Policy", "AWS::IAM::ManagedPolicy"];

const isBareWildcard = (resource: unknown): boolean =>
  [resource].flat().some((entry) => entry === "*");

// #region lint
/** Reads a synthesized CloudFormation template and reports every Allow that is wider than a named action on a named resource. */
export function lintTemplate(template: unknown, exceptions: LintException[] = []): LintResult {
  const allowed = new Map(
    v.parse(v.array(exceptionSchema), exceptions).map((entry) => [entry.action, entry]),
  );
  const used = new Set<string>();
  const findings: Finding[] = [];

  const inspect = (resource: string, document: unknown): void => {
    const parsed = v.safeParse(documentSchema, document);
    if (!parsed.success) {
      // A policy this code cannot read is not a policy it can vouch for.
      findings.push({
        resource,
        kind: "unreadable",
        detail: "the policy document did not have the expected shape",
      });
      return;
    }
    for (const statement of parsed.output.Statement) {
      // Deny statements narrow. A wildcard there is usually the point.
      if (statement.Effect === "Deny") {
        continue;
      }
      if (statement.NotAction !== undefined) {
        findings.push({
          resource,
          kind: "not-action",
          detail: "Allow with NotAction allows everything not listed",
        });
      }
      if (statement.NotResource !== undefined) {
        findings.push({
          resource,
          kind: "not-resource",
          detail: "Allow with NotResource allows everything not listed",
        });
      }
      const actions = statement.Action ?? [];
      for (const action of actions) {
        if (/[*?]/.test(action)) {
          findings.push({ resource, kind: "wildcard-action", detail: action });
        }
      }
      if (isBareWildcard(statement.Resource)) {
        for (const action of actions) {
          if (allowed.has(action)) {
            used.add(action);
          } else {
            findings.push({
              resource,
              kind: "wildcard-resource",
              detail: `${action} on Resource "*"`,
            });
          }
        }
      }
    }
  };

  const inspectTrust = (resource: string, document: unknown): void => {
    const parsed = v.safeParse(documentSchema, document);
    if (!parsed.success) {
      findings.push({
        resource,
        kind: "unreadable",
        detail: "the trust policy did not have the expected shape",
      });
      return;
    }
    for (const statement of parsed.output.Statement) {
      const principal = statement.Principal;
      const anyone =
        principal === "*" ||
        (typeof principal === "object" &&
          principal !== null &&
          isBareWildcard((principal as { AWS?: unknown }).AWS));
      if (statement.Effect === "Allow" && anyone && statement.Condition === undefined) {
        findings.push({
          resource,
          kind: "open-trust",
          detail: "any AWS principal may assume this role",
        });
      }
    }
  };

  for (const [logicalId, resource] of v.parse(templateSchema, template).Resources) {
    const properties = (resource.Properties ?? {}) as Record<string, unknown>;
    if (ONE_DOCUMENT.includes(resource.Type)) {
      inspect(logicalId, properties["PolicyDocument"]);
    }
    if (WITH_INLINE.includes(resource.Type)) {
      for (const policy of (properties["Policies"] ?? []) as { PolicyDocument?: unknown }[]) {
        inspect(logicalId, policy.PolicyDocument);
      }
      for (const arn of (properties["ManagedPolicyArns"] ?? []) as unknown[]) {
        // CDK writes these as Fn::Join over the partition; the policy name is in the last string part.
        const text = JSON.stringify(arn);
        const name = BROAD_MANAGED.exec(text.replace(/"\]*\}*$/, ""))?.[1];
        if (name !== undefined) {
          findings.push({ resource: logicalId, kind: "broad-managed-policy", detail: name });
        }
      }
    }
    if (resource.Type === "AWS::IAM::Role") {
      inspectTrust(logicalId, properties["AssumeRolePolicyDocument"]);
    }
  }

  // An exception nothing uses any more is a hole waiting for the next wildcard.
  const unusedExceptions = [...allowed.values()].filter((entry) => !used.has(entry.action));
  return { findings, unusedExceptions };
}
// #endregion lint

// #region assert
/** For CDK tests: `assertNoWildcards(Template.fromStack(stack).toJSON(), exceptions)`. */
export function assertNoWildcards(template: unknown, exceptions: LintException[] = []): void {
  const { findings, unusedExceptions } = lintTemplate(template, exceptions);
  const lines = [
    ...findings.map((finding) => `${finding.resource}: ${finding.kind}: ${finding.detail}`),
    ...unusedExceptions.map((entry) => `exception for ${entry.action} matches nothing; delete it`),
  ];
  if (lines.length > 0) {
    throw new Error(`IAM policies wider than they need to be:\n  ${lines.join("\n  ")}`);
  }
}
// #endregion assert
