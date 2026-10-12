import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { App } from "aws-cdk-lib";

import { readBuildInfo } from "../../scripts/lambda-harness.ts";
import { SsrStack } from "../lib/ssr-stack.ts";

// #region app
const outputDir = fileURLToPath(new URL("../../.output", import.meta.url));
if (!existsSync(`${outputDir}/nitro.json`)) {
  throw new Error(
    "examples/09-ssr/.output is missing. Run `vp run build:ssr` first: the stack deploys that build.",
  );
}

new SsrStack(new App(), "AihSsr", {
  env: { region: "ap-northeast-1" },
  description: "AWS in Your Hands chapter 09: Nuxt SSR on regional Lambda behind CloudFront",
  serverDir: `${outputDir}/server`,
  // The build decides, so the function URL cannot disagree with the handler it invokes.
  responseStreaming: readBuildInfo(outputDir).streaming,
});
// #endregion app
