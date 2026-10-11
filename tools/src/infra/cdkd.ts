// vp run <name>:infra:<action> ends up here.
//   node tools/src/infra/cdkd.ts <action> <appDir> <stack> [cdkd flags...]
import { resolve } from "node:path";
import { preflight } from "../aws/preflight.ts";
import { resolveTarget } from "../aws/target.ts";
import { ACTIONS, buildInvocation, isAction } from "./cdkd-args.ts";
import { runCdkd } from "./run-cdkd.ts";

const [action, appDir, stack, ...extra] = process.argv.slice(2);

if (!isAction(action) || appDir === undefined || stack === undefined) {
  console.error(`usage: cdkd.ts <${ACTIONS.join("|")}> <appDir> <stack> [cdkd flags...]`);
  process.exit(64);
}

try {
  const { region } = resolveTarget(process.env);
  const invocation = buildInvocation(action, stack, region, extra);
  if (invocation.access !== "local") {
    // "-" stands in for the stack argument of commands that take none.
    await preflight({ access: invocation.access, action: `cdkd ${action}`, ...(stack === "-" ? {} : { stack }) });
  }
  const result = await runCdkd({ appDir: resolve(appDir), args: invocation.args, region, capture: false });
  process.exit(result.exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
