import { App } from "aws-cdk-lib";

import { PollyStack } from "../lib/polly-stack.ts";

const app = new App();

// Only the Region is pinned. The account is whichever one the credentials belong to.
new PollyStack(app, "AihPolly", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 57: a note read aloud by Polly, cached in S3",
});
