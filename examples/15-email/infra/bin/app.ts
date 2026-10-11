import { App } from "aws-cdk-lib";
import { EmailStack } from "../lib/email-stack.ts";

const app = new App();
const context = (name: string) => app.node.tryGetContext(name) as string | undefined;

// example.com is reserved for documentation: it synthesizes, and must be replaced to deploy.
//   -c fromAddress=you@your-domain.example                         verify that one address
//   -c fromAddress=notes@your-domain.example -c senderIdentity=your-domain.example   verify the domain
const fromAddress = context("fromAddress") ?? "notes@example.com";

new EmailStack(app, "AihEmail", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 15: share notification mail (SES, SNS, Lambda, DynamoDB)",
  fromAddress,
  senderIdentity: context("senderIdentity") ?? fromAddress,
  appOrigin: context("appOrigin") ?? "http://localhost:5173",
  mailFromDomain: context("mailFromDomain"),
});
