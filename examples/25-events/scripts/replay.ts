// vp run events:replay -- --minutes 60 --rule timeline          what a replay would cover (reads AWS)
// vp run events:replay -- --minutes 60 --rule timeline --yes    starts it (changes AWS)
// vp run events:replay -- --describe <replay name>              how far a replay has got (reads AWS)
//   node scripts/replay.ts --minutes <n> [--rule timeline|counter|rejections]... [--name <name>] [--yes]
//
// Without --rule the events go to every rule on the bus. The rule for notices matches none of them.

import { parseArgs } from "node:util";

import {
  DescribeArchiveCommand,
  DescribeReplayCommand,
  EventBridgeClient,
  StartReplayCommand,
} from "@aws-sdk/client-eventbridge";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { planReplay } from "../src/replay-plan.ts";

const STACK = "AihEvents";
const { values } = parseArgs({
  options: {
    minutes: { type: "string" },
    rule: { type: "string", multiple: true },
    name: { type: "string" },
    describe: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

try {
  const describing = values.describe !== undefined;
  const { target } = await preflight({
    access: values.yes && !describing ? "mutate" : "observe",
    action: describing ? "read a replay's progress" : "replay archived events to the bus",
    stack: STACK,
  });
  const events = new EventBridgeClient({ region: target.region });

  if (values.describe !== undefined) {
    const replay = await events.send(new DescribeReplayCommand({ ReplayName: values.describe }));
    const reason = replay.StateReason === undefined ? "" : ` (${replay.StateReason})`;
    console.log(
      `${replay.ReplayName}: ${replay.State}${reason}, ` +
        `last event replayed ${replay.EventLastReplayedTime?.toISOString() ?? "none yet"}`,
    );
    process.exit(0);
  }

  const plan = planReplay(values, new Date());
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const archive = await events.send(
    new DescribeArchiveCommand({ ArchiveName: requireOutput(outputs, "ArchiveName") }),
  );
  if (archive.ArchiveArn === undefined || archive.EventSourceArn === undefined) {
    throw new Error("DescribeArchive returned no ARN for the archive or its bus");
  }
  const ruleArn = {
    timeline: "TimelineRuleArn",
    counter: "CounterRuleArn",
    rejections: "RejectionsRuleArn",
  };
  const filterArns = plan.rules.map((rule) => requireOutput(outputs, ruleArn[rule]));

  console.log(`replay:  ${plan.name}`);
  console.log(`window:  ${plan.from.toISOString()} to ${plan.to.toISOString()}`);
  console.log(
    `rules:   ${plan.rules.length === 0 ? "ALL rules on the bus" : plan.rules.join(", ")}`,
  );
  for (const warning of plan.warnings) {
    console.log(`warning: ${warning}`);
  }
  if (!values.yes) {
    console.log("Nothing was started. Add --yes to start this replay.");
    process.exit(0);
  }

  const started = await events.send(
    new StartReplayCommand({
      ReplayName: plan.name,
      EventSourceArn: archive.ArchiveArn,
      EventStartTime: plan.from,
      EventEndTime: plan.to,
      // A replay can only go back to the bus the archive was filled from.
      Destination: {
        Arn: archive.EventSourceArn,
        ...(filterArns.length === 0 ? {} : { FilterArns: filterArns }),
      },
    }),
  );
  console.log(`started: ${started.State}. Follow it with --describe ${plan.name}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
