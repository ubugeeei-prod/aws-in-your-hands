import { App } from "aws-cdk-lib";
import { HttpApiStack } from "../lib/http-api-stack.ts";

const app = new App();

new HttpApiStack(app, "AihHttpApi", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 04: notes HTTP API (API Gateway HTTP API + Lambda)",
  // Pass the SPA's URL with `-c allowedOrigin=https://dxxxx.cloudfront.net`.
  allowedOrigin: (app.node.tryGetContext("allowedOrigin") as string | undefined) ?? "http://localhost:5173",
});
