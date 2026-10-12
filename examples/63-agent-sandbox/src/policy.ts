// A small evaluator of identity policies over a synthesized template. It is this book's
// model, not IAM: it answers "could this role be allowed to?" and errs towards yes.

import { at, type Template } from "@aih/example-33-production-readiness/src/template.ts";

export type Scope = { partition: string; region: string; account: string };

export type Statement = {
  effect: "Allow" | "Deny";
  actions: string[];
  resources: string[];
  conditional: boolean;
};

export type RolePolicy = {
  statements: Statement[];
  /** Whatever this evaluator cannot read. A role with anything here has not been checked. */
  unread: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// #region render
const PSEUDO: Record<string, keyof Scope> = {
  "AWS::Partition": "partition",
  "AWS::Region": "region",
  "AWS::AccountId": "account",
};

/**
 * Turns the intrinsic functions CDK writes into ARNs into text. Ref to a pseudo parameter
 * becomes its value; Ref, Fn::GetAtt and Fn::ImportValue become a placeholder that stands
 * for one resource of this stack; Fn::Join joins. Anything else throws.
 */
export function render(value: unknown, scope: Scope): string {
  if (typeof value === "string") {
    return value;
  }
  if (isRecord(value)) {
    const [[name, inner] = ["", undefined], ...rest] = Object.entries(value);
    if (rest.length === 0) {
      if (name === "Ref" && typeof inner === "string") {
        const pseudo = PSEUDO[inner];
        return pseudo === undefined ? `<${inner}>` : scope[pseudo];
      }
      if (name === "Fn::GetAtt" && Array.isArray(inner)) {
        return `<${inner.join(".")}>`;
      }
      if (name === "Fn::ImportValue" && typeof inner === "string") {
        return `<import ${inner}>`;
      }
      if (name === "Fn::Join" && Array.isArray(inner) && Array.isArray(inner[1])) {
        return inner[1].map((part) => render(part, scope)).join(String(inner[0]));
      }
    }
  }
  throw new Error(`cannot render ${JSON.stringify(value)}`);
}
// #endregion render

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [value]);

// #region statements
/** Every statement attached to a role in this template: inline policies and AWS::IAM::Policy resources. */
export function rolePolicy(template: Template, roleId: string, scope: Scope): RolePolicy {
  const role = template.resources.find(
    (resource) => resource.id === roleId && resource.type === "AWS::IAM::Role",
  );
  if (role === undefined) {
    throw new Error(`no role ${roleId} in the template`);
  }
  const unread: string[] = [];
  // A managed policy lives outside the template, so what it allows cannot be read here.
  if (role.properties["ManagedPolicyArns"] !== undefined) {
    unread.push("ManagedPolicyArns");
  }
  if (role.properties["PermissionsBoundary"] !== undefined) {
    unread.push("PermissionsBoundary");
  }
  const documents: unknown[] = list(role.properties["Policies"] ?? []).map((policy) =>
    at(policy, "PolicyDocument"),
  );
  for (const resource of template.resources) {
    const attached = JSON.stringify(resource.properties["Roles"] ?? []).includes(
      JSON.stringify({ Ref: roleId }),
    );
    if (resource.type === "AWS::IAM::Policy" && attached) {
      documents.push(resource.properties["PolicyDocument"]);
    }
    if (resource.type === "AWS::IAM::ManagedPolicy" && attached) {
      unread.push(`AWS::IAM::ManagedPolicy ${resource.id}`);
    }
  }

  const statements: Statement[] = [];
  for (const raw of documents.flatMap((document) => list(at(document, "Statement") ?? []))) {
    if (!isRecord(raw)) {
      continue;
    }
    if (raw["NotAction"] !== undefined || raw["NotResource"] !== undefined) {
      unread.push("NotAction or NotResource");
      continue;
    }
    try {
      statements.push({
        effect: raw["Effect"] === "Deny" ? "Deny" : "Allow",
        actions: list(raw["Action"]).map((action) => String(action)),
        resources: list(raw["Resource"]).map((resource) => render(resource, scope)),
        conditional: raw["Condition"] !== undefined,
      });
    } catch (error) {
      unread.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { statements, unread };
}
// #endregion statements

/** IAM's wildcards: `*` for any run of characters, `?` for one. */
function glob(pattern: string, text: string, ignoreCase: boolean): boolean {
  const source = pattern
    .split("")
    .map((char) =>
      char === "*" ? ".*" : char === "?" ? "." : char.replace(/[\\^$.|+()[\]{}]/, "\\$&"),
    )
    .join("");
  return new RegExp(`^${source}$`, ignoreCase ? "i" : "").test(text);
}

// #region can
/**
 * Whether the statements could allow `action` on `resource`. An unconditional Deny wins. A
 * condition is not evaluated: an Allow with one counts as allowed, a Deny with one is ignored.
 * So "false" means no statement reaches it, and "true" means only that one might.
 */
export function can(statements: readonly Statement[], action: string, resource: string): boolean {
  const matching = statements.filter(
    (statement) =>
      statement.actions.some((pattern) => glob(pattern, action, true)) &&
      statement.resources.some((pattern) => glob(pattern, resource, false)),
  );
  if (matching.some((statement) => statement.effect === "Deny" && !statement.conditional)) {
    return false;
  }
  return matching.some((statement) => statement.effect === "Allow");
}
// #endregion can

/** Who may assume a role, as the template's trust policy lists them. */
export function trustedPrincipals(template: Template, roleId: string): string[] {
  const role = template.resources.find((resource) => resource.id === roleId);
  const statements = list(at(role?.properties["AssumeRolePolicyDocument"], "Statement") ?? []);
  return statements.flatMap((statement) =>
    Object.values(
      isRecord(at(statement, "Principal")) ? (at(statement, "Principal") as object) : {},
    )
      .flatMap((principal) => list(principal))
      .map((principal) => (typeof principal === "string" ? principal : JSON.stringify(principal))),
  );
}
