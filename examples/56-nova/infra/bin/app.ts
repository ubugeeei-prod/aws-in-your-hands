import { App } from "aws-cdk-lib";

import { NovaStack } from "../lib/nova-stack.ts";

const app = new App();

// Choose another route with `-c describeModel=amazon.nova-lite-v1:0`. `vp run nova:catalog` lists them.
new NovaStack(app, "AihNova", {
  env: { region: "ap-northeast-1" },
  description:
    "AWS in Your Hands chapter 56: one stored description per attached image (Lambda function URL + Amazon Nova on Bedrock + S3)",
  describeModel:
    (app.node.tryGetContext("describeModel") as string | undefined) ?? "jp.amazon.nova-2-lite-v1:0",
});
