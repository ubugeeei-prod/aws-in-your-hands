import { App } from "aws-cdk-lib";

import { AURORA_STACK, parseAuroraConfig, REGION } from "../../src/config.ts";
import { AuroraStack } from "../lib/aurora-stack.ts";

const app = new App();

const names = ["engineVersion", "minCapacity", "maxCapacity", "secondsUntilAutoPause", "storage"];
const config = parseAuroraConfig(
  Object.fromEntries(names.map((name) => [name, app.node.tryGetContext(name)])),
);

new AuroraStack(app, AURORA_STACK, {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 60: an Aurora PostgreSQL Serverless v2 cluster",
  config,
});
