import { App } from "aws-cdk-lib";

import { UploadsStack } from "../lib/uploads-stack.ts";

const app = new App();

new UploadsStack(app, "AihUploads", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 07: notes app with image uploads to S3",
});
