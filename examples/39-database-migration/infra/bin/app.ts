import { App } from "aws-cdk-lib";

import { MIGRATION_STACK, parseMigrationConfig, REGION } from "../../src/config.ts";
import { MigrationStack } from "../lib/migration-stack.ts";

const app = new App();

// #region context
const names = [
  "sourceHost",
  "sourceSecurityGroupId",
  "sourceDatabase",
  "targetHost",
  "targetSecurityGroupId",
  "targetDatabase",
  "minCapacityUnits",
  "maxCapacityUnits",
  "accountRoles",
];
const config = parseMigrationConfig(
  Object.fromEntries(names.map((name) => [name, app.node.tryGetContext(name)])),
);
// #endregion context

new MigrationStack(app, MIGRATION_STACK, {
  env: { region: REGION },
  description:
    "AWS in Your Hands chapter 39: an AWS DMS Serverless replication from RDS for PostgreSQL to Aurora PostgreSQL",
  config,
});
