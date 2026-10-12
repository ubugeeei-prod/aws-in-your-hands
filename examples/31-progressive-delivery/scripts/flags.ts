// vp run flags:check | flags:deploy | flags:status | flags:stop | flags:clear
//   node scripts/flags.ts <check|deploy|status|stop|clear> [--apply]
//
// `check` reads flags/flags.json and nothing else. The others talk to AppConfig;
// `deploy`, `stop`, and `clear` print what they would do and change nothing without --apply.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { AppConfigClient } from "@aws-sdk/client-appconfig";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import {
  clearVersions,
  deployFlags,
  type FlagTarget,
  listDeployments,
  stopDeployment,
  stopPlan,
} from "../src/flags/appconfig.ts";
import { parseDocument, toRetrieved } from "../src/flags/document.ts";
import { knownFlags } from "../src/flags/evaluate.ts";

const STACK = "AihProgressive";
const FILE = "flags/flags.json";

const { values, positionals } = parseArgs({
  options: { apply: { type: "boolean", default: false } },
  allowPositionals: true,
});
const [command] = positionals;

async function connect(access: "observe" | "mutate", action: string) {
  const { target } = await preflight({ access, action, stack: STACK });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const flags: FlagTarget = {
    applicationId: requireOutput(outputs, "FlagsApplicationId"),
    environmentId: requireOutput(outputs, "FlagsEnvironmentId"),
    profileId: requireOutput(outputs, "FlagsProfileId"),
    strategyId: requireOutput(outputs, "FlagsStrategyId"),
  };
  return { client: new AppConfigClient({ region: target.region }), flags };
}

try {
  // Every command starts by reading the file the way the application would.
  const document = parseDocument(await readFile(FILE, "utf8"), knownFlags);
  switch (command) {
    case "check": {
      console.log(`${FILE} is valid. An application would receive:`);
      console.log(JSON.stringify(toRetrieved(document), null, 2));
      break;
    }
    case "deploy": {
      if (!values.apply) {
        console.log(`Would store ${FILE} as a new version and start deploying it. Add --apply.`);
        console.log(JSON.stringify(toRetrieved(document), null, 2));
        break;
      }
      const { client, flags } = await connect("mutate", "deploy feature flags");
      const deployment = await deployFlags(
        client,
        flags,
        document,
        `flags:deploy ${new Date().toISOString()}`,
      );
      console.log(
        `deployment ${deployment.DeploymentNumber} of version ${deployment.ConfigurationVersion}: ${deployment.State}`,
      );
      break;
    }
    case "status": {
      const { client, flags } = await connect("observe", "read flag deployments");
      const deployments = await listDeployments(client, flags);
      if (deployments.length === 0) {
        console.log("No deployment yet. The application is running on the defaults in its code.");
      }
      for (const deployment of deployments.slice(0, 5)) {
        console.log(
          `deployment ${deployment.DeploymentNumber} version ${deployment.ConfigurationVersion}: ${deployment.State} ${deployment.PercentageComplete ?? 0}%`,
        );
      }
      break;
    }
    case "stop": {
      const { client, flags } = await connect(
        values.apply ? "mutate" : "observe",
        "stop a flag deployment",
      );
      const plan = stopPlan((await listDeployments(client, flags))[0]);
      if (plan.action === "nothing") {
        console.log(`Nothing to stop: ${plan.reason}.`);
        break;
      }
      if (!values.apply) {
        console.log(`Would ${plan.action} deployment ${plan.deployment}. Add --apply.`);
        break;
      }
      await stopDeployment(client, flags, plan);
      console.log(`Asked AppConfig to ${plan.action} deployment ${plan.deployment}.`);
      break;
    }
    case "clear": {
      if (!values.apply) {
        console.log("Would delete every stored version of the flag profile. Add --apply.");
        break;
      }
      const { client, flags } = await connect("mutate", "delete stored flag versions");
      const deleted = await clearVersions(client, flags);
      console.log(`Deleted ${deleted.length} stored version(s).`);
      break;
    }
    default:
      throw new Error("usage: flags.ts <check|deploy|status|stop|clear> [--apply]");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
