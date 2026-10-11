// vp run ship:cfn:<action> and ship:ci:<action> end up here.
//   node examples/20-shipping/scripts/cdk.ts <action> <api|ci> [cdk flags...]
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { resolveTarget } from "@aih/tools/aws/target.ts";
import { ACTIONS, buildCdkInvocation, isAction, isTarget, TARGETS } from "../src/cdk-args.ts";

const [action, target, ...extra] = process.argv.slice(2);
if (!isAction(action) || !isTarget(target)) {
  console.error(`usage: cdk.ts <${ACTIONS.join("|")}> <${TARGETS.join("|")}> [cdk flags...]`);
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
  const unattended = process.env["CI"] === "true";
  // Built once before any AWS call, so a bad stage or a missing flag stops here.
  const planned = buildCdkInvocation({ action, target, extra, unattended, accountId: "000000000000", region });

  let accountId: string | undefined;
  if (planned.access !== "local") {
    const { identity } = await preflight({
      access: planned.access,
      action: `cdk ${action}`,
      ...(planned.stack === null ? {} : { stack: planned.stack }),
    });
    accountId = identity.accountId;
  }
  const { args } = buildCdkInvocation({
    action,
    target,
    extra,
    unattended,
    region,
    ...(accountId === undefined ? {} : { accountId }),
  });

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
  // A signal means the CLI did not finish. The stack may be mid-operation: check ship:cfn:status.
  child.on("close", (code, signal) => process.exit(code ?? (signal === null ? 1 : 128)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
