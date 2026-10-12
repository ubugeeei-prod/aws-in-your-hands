import { App } from "aws-cdk-lib";
import * as v from "valibot";

import { RecoveryStack } from "../lib/recovery-stack.ts";

const app = new App();

// #region context
// Everything that is billed while idle, or that outlives the stack, is asked for by name.
//   -c table=<restored table>   the function reads this table instead of the stack's own
//   -c protect=on               RETAIN and deletion protection, as real data wants
//   -c backup=on                an AWS Backup vault and a daily plan
//   -c replica=on               a second bucket and S3 Replication into it
const flag = v.optional(v.picklist(["on", "off"]), "off");
const context = v.parse(
  v.object({
    // The names DynamoDB accepts. Anything else is a typo, not a table.
    table: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.-]{3,255}$/))),
    protect: flag,
    backup: flag,
    replica: flag,
  }),
  {
    table: app.node.tryGetContext("table"),
    protect: app.node.tryGetContext("protect"),
    backup: app.node.tryGetContext("backup"),
    replica: app.node.tryGetContext("replica"),
  },
);
// #endregion context

new RecoveryStack(app, "AihRecovery", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 22: a table and a bucket to lose data in and restore it",
  activeTableName: context.table,
  protect: context.protect === "on",
  backup: context.backup === "on",
  replica: context.replica === "on",
});
