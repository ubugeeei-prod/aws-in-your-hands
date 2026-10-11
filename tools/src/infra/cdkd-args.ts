import type { Access } from "../aws/target.ts";

export const ACTIONS = ["bootstrap", "synth", "diff", "deploy", "destroy", "local-api"] as const;
export type Action = (typeof ACTIONS)[number];

export type Invocation = {
  /** Whether the command talks to AWS at all, and whether it can change it. */
  access: Access | "local";
  args: string[];
};

/**
 * The exact cdkd command line for each project task, checked against the help
 * output and source of @go-to-k/cdkd 0.296.28.
 */
// #region invocation
export function buildInvocation(action: Action, stack: string, region: string, extra: string[]): Invocation {
  switch (action) {
    case "bootstrap":
      // Creates the cdkd state bucket (one per account) and this region's
      // asset bucket and ECR repository. It is the one command with --region.
      return { access: "mutate", args: ["bootstrap", "--region", region, ...extra] };
    case "synth":
      return { access: "local", args: ["synth", ...extra] };
    case "diff":
      // Compares the synthesized template with cdkd's state in S3. It does not
      // read the live resources; that is what `drift` is for.
      return { access: "observe", args: ["diff", stack, ...extra] };
    case "deploy":
      // --full-wait: a CloudFront distribution is otherwise reported as done
      // while it is still propagating to edge locations.
      return { access: "mutate", args: ["deploy", stack, "--full-wait", ...extra] };
    case "destroy":
      return { access: "mutate", args: ["destroy", stack, ...extra] };
    case "local-api":
      // Runs the synthesized API in local containers. The handlers receive the
      // developer's credentials, so SDK calls inside them reach real AWS.
      return { access: "local", args: ["local", "start-api", stack, "--watch", ...extra] };
  }
}
// #endregion invocation

export function isAction(value: string | undefined): value is Action {
  return (ACTIONS as readonly string[]).includes(value ?? "");
}
