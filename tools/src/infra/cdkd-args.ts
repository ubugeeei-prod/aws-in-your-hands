import type { Access } from "../aws/target.ts";

export const ACTIONS = ["bootstrap", "synth", "diff", "deploy", "destroy", "local-api"] as const;
export type Action = (typeof ACTIONS)[number];

export type Invocation = {
  /** Does the command talk to AWS, and can it change it? */
  access: Access | "local";
  args: string[];
};

// Checked against the help output and source of @go-to-k/cdkd 0.296.28.
// #region invocation
export function buildInvocation(action: Action, stack: string, region: string, extra: string[]): Invocation {
  switch (action) {
    case "bootstrap":
      // The one command that takes --region.
      return { access: "mutate", args: ["bootstrap", "--region", region, ...extra] };
    case "synth":
      return { access: "local", args: ["synth", ...extra] };
    case "diff":
      // Template against cdkd's state. Live resources are `drift`'s job.
      return { access: "observe", args: ["diff", stack, ...extra] };
    case "deploy":
      // --full-wait: otherwise CloudFront is reported done while still propagating.
      return { access: "mutate", args: ["deploy", stack, "--full-wait", ...extra] };
    case "destroy":
      return { access: "mutate", args: ["destroy", stack, ...extra] };
    case "local-api":
      // Handlers get the developer's credentials: SDK calls in them reach real AWS.
      return { access: "local", args: ["local", "start-api", stack, "--watch", ...extra] };
  }
}
// #endregion invocation

export function isAction(value: string | undefined): value is Action {
  return (ACTIONS as readonly string[]).includes(value ?? "");
}
