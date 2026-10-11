import { App } from "aws-cdk-lib";
import { SpaStack } from "../lib/spa-stack.ts";

const app = new App();

new SpaStack(app, "AihSpa", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 03: notes SPA (private S3 origin + CloudFront)",
});
