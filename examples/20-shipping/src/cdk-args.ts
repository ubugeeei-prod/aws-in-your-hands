import * as v from "valibot";

import type { Access } from "@aih/tools/aws/target.ts";

import { apiStackName, type Stage, stageSchema } from "../infra/lib/config.ts";

export const ACTIONS = ["bootstrap", "synth", "diff", "deploy", "destroy"] as const;
export type Action = (typeof ACTIONS)[number];

/** `api` is the stack of the selected stage. `ci` is the OIDC provider and roles. */
export const TARGETS = ["api", "ci"] as const;
export type Target = (typeof TARGETS)[number];

export const CI_STACK = "AihShipCi";

export type Invocation = {
  access: Access | "local";
  /** null for commands that act on the environment or on every stack. */
  stack: string | null;
  args: string[];
};

/** Reads `-c key=value` / `--context key=value` the way the CDK CLI will. */
export function contextValue(extra: string[], key: string): string | undefined {
  let value: string | undefined;
  extra.forEach((arg, index) => {
    const next = extra[index + 1];
    if ((arg === "-c" || arg === "--context") && next?.startsWith(`${key}=`)) {
      value = next.slice(key.length + 1);
    }
  });
  return value;
}

export function stageFrom(extra: string[]): Stage {
  const result = v.safeParse(stageSchema, contextValue(extra, "stage") ?? "dev");
  if (!result.success) {
    throw new Error('stage must be "dev", "prod", or "pr-<number>"');
  }
  return result.output;
}

// Checked against the help output of aws-cdk 2.1145.0.
// #region invocation
export function buildCdkInvocation(input: {
  action: Action;
  target: Target;
  extra: string[];
  /** True in CI: nobody is there to answer a prompt. */
  unattended: boolean;
  accountId?: string;
  region: string;
}): Invocation {
  const { action, target, extra, unattended } = input;
  const stack = target === "ci" ? CI_STACK : apiStackName(stageFrom(extra));
  const has = (...flags: string[]) => extra.some((arg) => flags.includes(arg));

  switch (action) {
    case "bootstrap": {
      if (input.accountId === undefined) {
        throw new Error("bootstrap needs the account ID of the credentials in use");
      }
      // Creates the CDKToolkit stack: asset bucket, ECR repository, and five IAM roles.
      return {
        access: "mutate",
        stack: null,
        args: ["bootstrap", `aws://${input.accountId}/${input.region}`, ...extra],
      };
    }
    case "synth":
      return { access: "local", stack: null, args: ["synth", "--quiet", ...extra] };
    case "diff":
      // Template against the deployed template, read through the lookup role.
      // `--method change-set` asks CloudFormation instead, and needs the deploy role.
      return {
        access: "observe",
        stack,
        args: ["diff", stack, ...(has("--method", "-m") ? [] : ["--method", "template"]), ...extra],
      };
    case "deploy": {
      if (target === "ci" && contextValue(extra, "githubRepository") === undefined) {
        throw new Error(
          "Deploying the CI roles needs `-c githubRepository=<owner>/<repo>`: the roles trust that repository.",
        );
      }
      // A change set, executed by CloudFormation, rolled back by CloudFormation if a resource fails.
      const approval = unattended ? "never" : "broadening";
      return {
        access: "mutate",
        stack,
        args: ["deploy", stack, "--require-approval", approval, ...extra],
      };
    }
    case "destroy":
      return {
        access: "mutate",
        stack,
        args: ["destroy", stack, ...(unattended ? ["--force"] : []), ...extra],
      };
  }
}
// #endregion invocation

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (value: string | undefined): value is T =>
    (values as readonly string[]).includes(value ?? "");

export const isAction = isOneOf(ACTIONS);
export const isTarget = isOneOf(TARGETS);
