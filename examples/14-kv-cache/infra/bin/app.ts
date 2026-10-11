import { App } from "aws-cdk-lib";
import { z } from "zod";
import { KvCacheStack } from "../lib/kv-cache-stack.ts";

const app = new App();

// #region context
// `-c store=valkey` adds the ElastiCache Serverless cache. Without it, nothing in the stack is billed while idle.
const store = z.enum(["dynamodb", "valkey"]).default("dynamodb").parse(app.node.tryGetContext("store"));
// #endregion context

new KvCacheStack(app, "AihKvCache", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 14: a rate limit and a cache on DynamoDB or Valkey",
  store,
});
