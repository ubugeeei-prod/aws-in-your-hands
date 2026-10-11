import { App } from "aws-cdk-lib";
import { BookSiteStack } from "../lib/book-site-stack.ts";

const app = new App();

// The region is fixed so synth never asks AWS. The account is whichever the credentials belong to.
new BookSiteStack(app, "AihBookSite", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands: static book site (private S3 origin + CloudFront)",
});
