import { App } from "aws-cdk-lib";

import { BodyDigestStack } from "../lib/body-digest-stack.ts";
import { EdgeStack } from "../lib/edge-stack.ts";

const app = new App();

// #region stacks
new EdgeStack(app, "AihEdge", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 10: CloudFront Functions and KeyValueStore",
  // Optional. Pass the output of AihEdgeBodyDigest with `-c bodyDigestVersionArn=arn:aws:lambda:us-east-1:...:1`.
  bodyDigestVersionArn: app.node.tryGetContext("bodyDigestVersionArn") as string | undefined,
});

// The one stack in this book outside ap-northeast-1: Lambda@Edge functions are created in us-east-1.
new BodyDigestStack(app, "AihEdgeBodyDigest", {
  env: { region: "us-east-1" },
  description: "AWS in Your Hands chapter 10: a Lambda@Edge function that reads the request body",
});
// #endregion stacks
