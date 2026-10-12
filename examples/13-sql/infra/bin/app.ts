import { App } from "aws-cdk-lib";

import { SqlStack } from "../lib/sql-stack.ts";

const app = new App();

new SqlStack(app, "AihSql", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 13: notes HTTP API on Aurora DSQL",
  allowedOrigin:
    (app.node.tryGetContext("allowedOrigin") as string | undefined) ?? "http://localhost:5173",
});
