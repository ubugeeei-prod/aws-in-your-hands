import { contextValue } from "@aih/example-20-shipping/src/cdk-args.ts";
import type { Access } from "@aih/tools/aws/target.ts";

import { OUTPUTS_FILE, STACK } from "./names.ts";
import { parseRelease } from "./release.ts";

export const ACTIONS = ["synth", "diff", "deploy", "destroy"] as const;
export type Action = (typeof ACTIONS)[number];

export const isAction = (value: string | undefined): value is Action =>
  (ACTIONS as readonly string[]).includes(value ?? "");

export type Invocation = { access: Access | "local"; args: string[] };

/** Ours, not the CLI's: "I mean the stack with no revision and no endpoint." */
export const FOUNDATION_FLAG = "--foundation";

// Checked against the help output of aws-cdk 2.1145.0.
// #region invocation
/** The arguments for the AWS CDK CLI. Built before any AWS call, so a bad release stops here. */
export function cdkInvocation(input: {
  action: Action;
  extra: string[];
  /** True in CI: nobody is there to answer a prompt. */
  unattended: boolean;
}): Invocation {
  const { action, unattended } = input;
  const extra = input.extra.filter((arg) => arg !== FOUNDATION_FLAG);
  // Throws on `-c canary=...` without a weight, and the like.
  const release = parseRelease((key) => contextValue(extra, key));
  // `-c` holds for one run. A deploy that forgets it would take the endpoint away,
  // and Lambda never gives an endpoint's domain name out again.
  if (action === "deploy" && release === undefined && extra.length === input.extra.length) {
    throw new Error(
      `Without -c stable=<S3 version ID> this deploy removes every revision and the endpoint. ` +
        `For the first deploy, before any upload, pass ${FOUNDATION_FLAG}.`,
    );
  }

  switch (action) {
    case "synth":
      return { access: "local", args: ["synth", "--quiet", ...extra] };
    case "diff":
      // Template against the deployed template. No change set is created.
      return { access: "observe", args: ["diff", STACK, "--method", "template", ...extra] };
    case "deploy":
      return {
        access: "mutate",
        args: [
          "deploy",
          STACK,
          "--require-approval",
          unattended ? "never" : "broadening",
          // The endpoint's URL is a stack output. The smoke test reads it from this file.
          "--outputs-file",
          OUTPUTS_FILE,
          ...extra,
        ],
      };
    case "destroy":
      return {
        access: "mutate",
        args: ["destroy", STACK, ...(unattended ? ["--force"] : []), ...extra],
      };
  }
}
// #endregion invocation
