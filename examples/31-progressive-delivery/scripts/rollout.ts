// vp run rollout:plan | rollout:start | rollout:status | rollout:rollback
//   node scripts/rollout.ts <plan|start|status|rollback> [--plan Canary10Percent5Minutes]
//     [--bake 300] [--poll 30] [--max-blind 300] [--version N] [--to N] [--apply]
//
// `plan` is arithmetic and touches nothing. `status` reads. `start` and `rollback`
// print what they would do and change nothing without --apply.

import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { LambdaClient } from "@aws-sdk/client-lambda";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { cloudWatchAlarms, lambdaAlias, publishVersion } from "../src/shift/aws.ts";
import { aliasAt, chanceOfNoSample, planFor, requestsForSample } from "../src/shift/plan.ts";
import { runShift } from "../src/shift/run.ts";

const STACK = "AihProgressive";

const { values, positionals } = parseArgs({
  options: {
    plan: { type: "string", default: "Canary10Percent5Minutes" },
    bake: { type: "string", default: "300" },
    poll: { type: "string", default: "30" },
    "max-blind": { type: "string", default: "300" },
    version: { type: "string" },
    to: { type: "string" },
    apply: { type: "boolean", default: false },
  },
  allowPositionals: true,
});
const [command] = positionals;

const seconds = (text: string, name: string) => {
  const value = Number(text);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`--${name} must be a whole number of seconds.`);
  }
  return value;
};

async function connect(access: "observe" | "mutate", action: string) {
  const { target } = await preflight({ access, action, stack: STACK });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const functionName = requireOutput(outputs, "FunctionName");
  const lambda = new LambdaClient({ region: target.region });
  return {
    lambda,
    functionName,
    alias: lambdaAlias(lambda, functionName, requireOutput(outputs, "AliasName")),
    alarms: cloudWatchAlarms(
      new CloudWatchClient({ region: target.region }),
      requireOutput(outputs, "AlarmNames").split(","),
    ),
  };
}

const show = (alias: { version: string; weights: Record<string, number> }) =>
  Object.keys(alias.weights).length === 0
    ? `100% on version ${alias.version}`
    : `${Object.entries(alias.weights)
        .map(([version, weight]) => `${Math.round(weight * 100)}% on version ${version}`)
        .join(", ")}, the rest on version ${alias.version}`;

try {
  const plan = planFor(values.plan, seconds(values.bake, "bake"));
  switch (command) {
    case "plan": {
      let elapsed = 0;
      console.log(plan.name);
      for (const step of plan.steps) {
        console.log(
          `  at ${String(elapsed).padStart(5)} s: ${String(step.percent).padStart(3)}% on the new version, watched for ${step.holdSeconds} s`,
        );
        elapsed += step.holdSeconds;
      }
      console.log(`  done after ${elapsed} s at the earliest`);
      const first = plan.steps[0];
      if (first !== undefined && first.percent < 100) {
        console.log(
          `  at ${first.percent}%, 20 requests all miss the new version with probability ${chanceOfNoSample(first.percent, 20).toFixed(3)};`,
        );
        console.log(
          `  it takes ${requestsForSample(first.percent, 0.01)} requests to bring that below 0.01`,
        );
      }
      break;
    }
    case "status": {
      const { alias, alarms } = await connect("observe", "read the alias and its alarms");
      console.log(`alias: ${show(await alias.read())}`);
      for (const alarm of await alarms.read()) {
        console.log(`alarm ${alarm.name}: ${alarm.state}`);
      }
      break;
    }
    case "start": {
      const { lambda, functionName, alias, alarms } = await connect(
        values.apply ? "mutate" : "observe",
        "shift the alias to a new version",
      );
      if (!values.apply) {
        console.log(`alias now: ${show(await alias.read())}`);
        console.log(
          `Would ${values.version === undefined ? "publish a version of the deployed code" : `use version ${values.version}`} and shift to it with ${plan.name}. Add --apply.`,
        );
        break;
      }
      const to =
        values.version ??
        (await publishVersion(lambda, functionName, `rollout:start ${new Date().toISOString()}`));
      console.log(`target: version ${to}`);
      const result = await runShift({
        alias,
        alarms,
        clock: { now: Date.now, sleep: async (milliseconds) => void (await sleep(milliseconds)) },
        plan,
        to,
        pollSeconds: seconds(values.poll, "poll"),
        limits: { maxBlindSeconds: seconds(values["max-blind"], "max-blind") },
        log: (line) => console.log(`${new Date().toISOString()} ${line}`),
      });
      console.log(JSON.stringify(result));
      // Only a finished shift is a success. A rollback worked as designed, and the release still failed.
      process.exit(result.outcome === "completed" ? 0 : 1);
      break;
    }
    case "rollback": {
      const { alias } = await connect(values.apply ? "mutate" : "observe", "point the alias back");
      const view = await alias.read();
      const weighted = Object.keys(view.weights).length > 0;
      if (!weighted && values.to === undefined) {
        throw new Error(
          `The alias is at ${show(view)} with no shift in progress. Name the version to return to with --to.`,
        );
      }
      // Mid-shift the alias still names the old version: removing the weight is the rollback.
      const target = aliasAt(0, weighted ? view.version : (values.to ?? view.version), "");
      console.log(`alias now: ${show(view)}`);
      if (!values.apply) {
        console.log(`Would set it to ${show(target)}. Add --apply.`);
        break;
      }
      console.log(`alias set: ${show(await alias.write(target, view.revisionId))}`);
      break;
    }
    default:
      throw new Error("usage: rollout.ts <plan|start|status|rollback> [options]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
