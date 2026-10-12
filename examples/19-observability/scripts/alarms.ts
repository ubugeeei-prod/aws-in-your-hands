// vp run obs:alarms
//   node scripts/alarms.ts
//
// Shows the state of the alarms that notify this stack's topic. Reads only.

import { spawnSync } from "node:child_process";

import { z } from "zod";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const STACK = "AihObservability";

const alarmsSchema = z.object({
  MetricAlarms: z.array(
    z.object({
      AlarmName: z.string(),
      StateValue: z.enum(["OK", "ALARM", "INSUFFICIENT_DATA"]),
      StateReason: z.string().optional(),
      StateUpdatedTimestamp: z.string().optional(),
      AlarmActions: z.array(z.string()).default([]),
    }),
  ),
});

try {
  const { target } = await preflight({
    access: "observe",
    action: "read alarm states",
    stack: STACK,
  });
  const topicArn = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "AlarmTopicArn",
  );
  const result = spawnSync(
    "aws",
    ["cloudwatch", "describe-alarms", "--region", target.region, "--output", "json"],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(`aws cloudwatch describe-alarms failed:\n${result.stderr}`);
  }
  const alarms = alarmsSchema
    .parse(JSON.parse(result.stdout))
    .MetricAlarms.filter((alarm) => alarm.AlarmActions.includes(topicArn));
  if (alarms.length === 0) {
    throw new Error(`no alarm notifies ${topicArn}`);
  }
  for (const alarm of alarms) {
    console.log(
      `${alarm.StateValue.padEnd(17)} ${alarm.AlarmName} (since ${alarm.StateUpdatedTimestamp ?? "?"})`,
    );
    console.log(`  ${alarm.StateReason ?? ""}`);
  }
  // INSUFFICIENT_DATA right after a deploy is expected: nothing has been evaluated yet.
  process.exit(alarms.some((alarm) => alarm.StateValue === "ALARM") ? 2 : 0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
