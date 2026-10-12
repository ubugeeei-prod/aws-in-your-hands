// vp run sandbox:policy [-- --exec] [--model-endpoint]
//   node scripts/policy.ts
//
// Synthesizes the stack in this process and prints what each of its roles could be
// allowed to do, by this chapter's own evaluator. Asks AWS nothing; it is not IAM's answer.

import { parseArgs } from "node:util";

import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import { readTemplate } from "@aih/example-33-production-readiness/src/template.ts";

import { AgentSandboxStack } from "../infra/lib/agent-sandbox-stack.ts";
import { parseSandboxConfig, REGION, SANDBOX_STACK } from "../src/config.ts";
import { can, rolePolicy } from "../src/policy.ts";

const { values } = parseArgs({
  options: {
    exec: { type: "boolean", default: false },
    "model-endpoint": { type: "boolean", default: false },
  },
});

const stack = new AgentSandboxStack(
  new App({ outdir: `${process.env["TMPDIR"] ?? "/tmp"}/aih-sandbox-policy` }),
  SANDBOX_STACK,
  {
    env: { region: REGION },
    config: parseSandboxConfig({
      imageTag: "a1",
      repositories: "acme/notes",
      exec: String(values.exec),
      modelEndpoint: String(values["model-endpoint"]),
    }),
  },
);
const template = readTemplate(Template.fromStack(stack).toJSON());
// Made-up accounts: the sandbox's own, and one that stands for production.
const scope = { partition: "aws", region: REGION, account: "111111111111" };
const production = "999999999999";

const roles = template.resources.filter((resource) => resource.type === "AWS::IAM::Role");
for (const role of roles) {
  const { statements, unread } = rolePolicy(template, role.id, scope);
  console.log(`\n${role.id}`);
  for (const statement of statements) {
    const condition = statement.conditional ? "  (with a condition, not evaluated)" : "";
    console.log(`  ${statement.effect} ${statement.actions.join(", ")}${condition}`);
    for (const resource of statement.resources) {
      console.log(`      on ${resource}`);
    }
  }
  if (statements.length === 0) {
    console.log("  (no statements)");
  }
  for (const item of unread) {
    console.log(`  NOT READ: ${item}`);
  }
}

// #region probes
const probes: [string, string][] = [
  ["sts:AssumeRole", `arn:aws:iam::${production}:role/aih-deploy`],
  ["dynamodb:GetItem", `arn:aws:dynamodb:${REGION}:${production}:table/notes`],
  ["s3:GetObject", "arn:aws:s3:::aih-attachments/owner/file"],
  [
    "secretsmanager:GetSecretValue",
    `arn:aws:secretsmanager:${REGION}:${scope.account}:secret:aih/agent-sandbox/github-app-AbCdEf`,
  ],
  ["ecs:RunTask", `arn:aws:ecs:${REGION}:${scope.account}:task-definition/any:1`],
  ["iam:PassRole", `arn:aws:iam::${scope.account}:role/any`],
];
// #endregion probes
const taskRole = roles.find((role) => role.id.startsWith("TaskRole"));
if (taskRole !== undefined) {
  const { statements } = rolePolicy(template, taskRole.id, scope);
  console.log("\nCould the agent's role be allowed to...");
  for (const [action, resource] of probes) {
    console.log(`  ${can(statements, action, resource) ? "YES" : "no "}  ${action} on ${resource}`);
  }
}
