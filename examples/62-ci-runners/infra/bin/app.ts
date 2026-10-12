import { App } from "aws-cdk-lib";

import { parseRunnerConfig, REGION, RUNNER_STACK } from "../../src/config.ts";
import { RunnerStack } from "../lib/runner-stack.ts";

const app = new App();

// #region context
// Without `-c repositories=owner/repo` and `-c appClientId=...` the receiver refuses every delivery.
const config = parseRunnerConfig({
  repositories: app.node.tryGetContext("repositories"),
  appClientId: app.node.tryGetContext("appClientId"),
  runnerGroupId: app.node.tryGetContext("runnerGroupId"),
});
// #endregion context

new RunnerStack(app, RUNNER_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 62: a webhook receiver that starts one Fargate task per queued GitHub Actions job",
  config,
});
