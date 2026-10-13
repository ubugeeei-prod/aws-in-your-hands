// vp run webfn:cfn:<action> ends up here.
//   node examples/69-web-functions/scripts/cdk.ts <synth|diff|deploy|destroy> [cdk flags...]
//
// cdkd 0.296.28 has no provider for AWS::Lambda::WebFunction and its two companions,
// so this one stack goes through the AWS CDK CLI and CloudFormation, as in chapter 20.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { resolveTarget } from "@aih/tools/aws/target.ts";

import { ACTIONS, cdkInvocation, isAction } from "../src/cdk-args.ts";
import { STACK } from "../src/names.ts";

const [action, ...extra] = process.argv.slice(2);
if (!isAction(action)) {
  console.error(`usage: cdk.ts <${ACTIONS.join("|")}> [cdk flags...]`);
  process.exit(64);
}

const appDir = fileURLToPath(new URL("..", import.meta.url));
// The CLI is the root package's pinned devDependency.
const cdk = fileURLToPath(new URL("../../../node_modules/.bin/cdk", import.meta.url));

try {
  if (!existsSync(cdk)) {
    throw new Error("The CDK CLI is not installed. Run `vp install` from the repository root.");
  }
  const { region } = resolveTarget(process.env);
  const { access, args } = cdkInvocation({
    action,
    extra,
    unattended: process.env["CI"] === "true",
  });
  if (access !== "local") {
    await preflight({ access, action: `cdk ${action}`, stack: STACK });
  }

  console.error(`$ (cd ${appDir} && AWS_REGION=${region} cdk ${args.join(" ")})`);
  const child = spawn(cdk, args, {
    cwd: appDir,
    env: {
      ...process.env,
      AWS_REGION: region,
      // Synth must not call out anywhere: no telemetry, no version check. Notices are off in cdk.json.
      CDK_DISABLE_CLI_TELEMETRY: "true",
      CDK_DISABLE_VERSION_CHECK: "1",
    },
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
  child.on("close", (code, signal) => process.exit(code ?? (signal === null ? 1 : 128)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
