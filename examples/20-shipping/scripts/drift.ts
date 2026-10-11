// vp run ship:cfn:drift [-c stage=prod] [--interval-ms 5000] [--max-attempts 60]
//   node examples/20-shipping/scripts/drift.ts ...
//
// Starts CloudFormation drift detection, waits for it, and writes
// reports/drift/<stack>.json. Reads AWS; changes nothing a deploy manages.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { buildCfnReport, detectStackDrift, summarizeCfn } from "@aih/tools/drift/cloudformation.ts";
import { CloudFormationClient } from "@aws-sdk/client-cloudformation";
import { z } from "zod";
import { apiStackName } from "../infra/lib/config.ts";
import { stageFrom } from "../src/cdk-args.ts";
import { cfnDriftApi } from "../src/drift-client.ts";
import { ACKNOWLEDGED_UNCHECKED_TYPES } from "../src/drift-coverage.ts";

const count = z.coerce.number().int().positive();

try {
  const { values } = parseArgs({
    options: {
      context: { type: "string", short: "c", multiple: true, default: [] },
      // A stack of this size should finish in seconds; 5 minutes is where this stops waiting.
      "interval-ms": { type: "string", default: "5000" },
      "max-attempts": { type: "string", default: "60" },
    },
  });
  const stack = apiStackName(stageFrom(values.context.flatMap((entry) => ["-c", entry])));
  const polling = { intervalMs: count.parse(values["interval-ms"]), maxAttempts: count.parse(values["max-attempts"]) };

  const { target, identity } = await preflight({ access: "observe", action: "detect CloudFormation drift", stack });
  const executedAt = new Date();
  const client = new CloudFormationClient({ region: target.region });
  const outcome = await detectStackDrift({ stack, api: cfnDriftApi(client), polling, sleep: (ms) => sleep(ms) });

  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    dependencies: Record<string, string>;
  };
  const report = buildCfnReport({
    stack,
    outcome,
    target: { accountId: identity.accountId, region: target.region },
    executedAt,
    toolVersion: `@aws-sdk/client-cloudformation ${manifest.dependencies["@aws-sdk/client-cloudformation"]}`,
    acknowledgedTypes: [...ACKNOWLEDGED_UNCHECKED_TYPES],
  });

  const path = resolve("reports/drift", `${stack}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(summarizeCfn(report));
  console.log(`report: ${path}`);
  process.exit(report.acknowledged.exitCode);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  // Same code as a failed detection: nothing was established.
  process.exit(12);
}
