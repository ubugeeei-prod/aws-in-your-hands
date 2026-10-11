import { App } from "aws-cdk-lib";
import { BookSiteStack } from "../lib/book-site-stack.ts";

const app = new App();

// The region is fixed in source so that synth never asks AWS anything. The
// account is left unresolved: the stack deploys to whichever account the
// credentials in use belong to, and tools/src/aws/preflight.ts prints and
// checks that account before every command that touches AWS.
new BookSiteStack(app, "AihBookSite", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands: static book site (private S3 origin + CloudFront)",
});
