// vp run <name>:infra:drift and the drift remediation tasks end up here.
//   node tools/src/drift/cli.ts <check|preview-revert|revert|accept> <appDir> <stack>

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { preflight } from "../aws/preflight.ts";
import { runCdkd } from "../infra/run-cdkd.ts";
import { driftArgs, isMode, type Mode, MODES } from "./args.ts";
import { buildReport, summarize } from "./report.ts";

const [mode, appDirArg, stack, ...extra] = process.argv.slice(2);
if (!isMode(mode) || appDirArg === undefined || stack === undefined) {
  console.error(`usage: cli.ts <${MODES.join("|")}> <appDir> <stack>`);
  process.exit(64);
}
if (extra.length > 0) {
  // Better to stop than to let `-c store=valkey` look as if it selected something.
  console.error(`unexpected arguments: ${extra.join(" ")}`);
  console.error(
    "cdkd drift compares the recorded state with AWS. It does not synthesize, so context (-c) has no effect.",
  );
  process.exit(64);
}
const appDir = resolve(appDirArg);

function cdkdVersion(): string {
  const manifest = resolve(appDir, "node_modules/@go-to-k/cdkd/package.json");
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
}

async function check(): Promise<number> {
  const { target, identity } = await preflight({ access: "observe", action: "cdkd drift", stack });
  const executedAt = new Date();
  const run = await runCdkd({
    appDir,
    args: driftArgs("check", stack as string),
    region: target.region,
    capture: true,
  });
  const report = buildReport({
    requestedStacks: [stack as string],
    run,
    target: { accountId: identity.accountId, region: target.region },
    executedAt,
    toolVersion: cdkdVersion(),
  });

  const path = resolve("reports/drift", `${stack}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(summarize(report));
  console.log(`report: ${path}`);
  return report.gate.exitCode;
}

async function remediate(kind: Exclude<Mode, "check">): Promise<number> {
  const args = driftArgs(kind, stack as string);
  const { target } = await preflight({
    access: kind === "preview-revert" ? "observe" : "mutate",
    action: `cdkd ${args.filter((arg) => arg !== stack).join(" ")}`,
    stack,
  });
  const result = await runCdkd({
    appDir,
    args,
    region: target.region,
    capture: false,
  });
  if (kind !== "preview-revert") {
    console.error(
      "\nRun the drift check again. This command's exit code does not show that the stack is now in sync.",
    );
  }
  return result.exitCode;
}

try {
  process.exit(mode === "check" ? await check() : await remediate(mode as Exclude<Mode, "check">));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  // Same code as a failed detection: nothing was established.
  process.exit(12);
}
