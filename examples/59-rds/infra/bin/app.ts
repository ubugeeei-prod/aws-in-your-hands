import { App } from "aws-cdk-lib";

import { parseRdsConfig, RDS_STACK, REGION } from "../../src/config.ts";
import { RdsStack } from "../lib/rds-stack.ts";

const app = new App();
const context = (key: string): unknown => app.node.tryGetContext(key);

new RdsStack(app, RDS_STACK, {
  env: { region: REGION },
  description: "AWS in Your Hands chapter 59: RDS for PostgreSQL in the private subnets",
  config: parseRdsConfig({
    allowedOrigin: context("allowedOrigin"),
    profile: context("profile"),
    postgresVersion: context("postgresVersion"),
    instanceClass: context("instanceClass"),
    readReplica: context("readReplica"),
  }),
});
