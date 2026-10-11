// vp run ship:cfn:status [-c stage=prod]
//   node examples/20-shipping/scripts/status.ts ...
//
// Where did the last operation on the stack stop, and what is safe to do next? Reads only.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { apiStackName } from "../infra/lib/config.ts";
import { stageFrom } from "../src/cdk-args.ts";
import { describeStack } from "../src/stack-info.ts";
import { nextStep } from "../src/stack-status.ts";

try {
  const { values } = parseArgs({ options: { context: { type: "string", short: "c", multiple: true, default: [] } } });
  const name = apiStackName(stageFrom(values.context.flatMap((entry) => ["-c", entry])));
  const { target } = await preflight({ access: "observe", action: "read stack status", stack: name });

  const stack = await describeStack(new CloudFormationClient({ region: target.region }), name);
  if (stack === null) {
    console.log(`${name}: not deployed in ${target.region}.`);
    process.exit(0);
  }
  const step = nextStep(stack.StackStatus);
  console.log(
    [
      `${name}: ${stack.StackStatus} (${step.state})`,
      ...(stack.StackStatusReason === undefined ? [] : [`reason: ${stack.StackStatusReason}`]),
      `last changed: ${(stack.LastUpdatedTime ?? stack.CreationTime).toISOString()}`,
      `termination protection: ${stack.EnableTerminationProtection === true ? "on" : "off"}`,
      `deploy now: ${step.deployable ? "possible" : "not possible"}`,
      step.advice,
    ].join("\n"),
  );
  // Non-zero only when someone has to act before the next deploy.
  process.exit(step.state === "needs-repair" ? 1 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
