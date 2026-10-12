// vp run stream:status [--expect-offline] [--events] [--since 3h]
//   node scripts/status.ts
//
// Read-only. Asks IVS whether the channel is live (GetStream). With --events it
// also reads the events the function logged and says whether they tell the
// same story. --expect-offline exits 1 while the channel is live.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

import { IvsClient } from "@aws-sdk/client-ivs";
import { z } from "zod";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { getStreamStatus } from "../src/ivs.ts";
import { parseLoggedEvents } from "../src/logged-events.ts";
import { describeStatus } from "../src/stream.ts";
import { believe, reconcile } from "../src/timeline.ts";

const { values } = parseArgs({
  options: {
    "expect-offline": { type: "boolean", default: false },
    events: { type: "boolean", default: false },
    since: { type: "string", default: "3h" },
  },
});

const sinceMs = (since: string): number => {
  const match = /^(\d+)([mh])$/.exec(since);
  if (match === null) {
    throw new Error(`--since takes minutes or hours, such as 30m or 3h; got "${since}"`);
  }
  return Number(match[1]) * (match[2] === "h" ? 3_600_000 : 60_000);
};

const logsOutputSchema = z.object({ events: z.array(z.object({ message: z.string() })) });

try {
  const { target } = await preflight({
    access: "observe",
    action: "read the stream state",
    stack: "AihLive",
  });
  const outputs = await readStackOutputs(process.cwd(), "AihLive", target.region);
  const channelArn = requireOutput(outputs, "ChannelArn");
  const now = new Date();

  const status = await getStreamStatus(new IvsClient({ region: target.region }), channelArn);
  console.log(describeStatus(status, now));

  if (values.events) {
    const args = ["logs", "filter-log-events", "--region", target.region, "--output", "json"];
    args.push("--log-group-name", requireOutput(outputs, "EventLogGroupName"));
    args.push("--start-time", String(now.getTime() - sinceMs(values.since)));
    const result = spawnSync("aws", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new Error(`aws logs filter-log-events exited with ${result.status}: ${result.stderr}`);
    }
    const records = parseLoggedEvents(
      logsOutputSchema.parse(JSON.parse(result.stdout)).events.map((e) => e.message),
    );
    for (const record of records) {
      console.log(
        `event    ${record.eventTime}  +${record.lagMs} ms  ${record.name}  ${record.streamId ?? "-"}`,
      );
    }
    const verdict = reconcile(believe(records), status);
    console.log(
      verdict.agrees
        ? `events   ${records.length} in the last ${values.since}, consistent with GetStream`
        : `events   DISAGREE with GetStream for ${verdict.streamId}: ${verdict.reason}. GetStream is the answer.`,
    );
  }

  console.log(`checked at ${now.toISOString()}`);
  if (values["expect-offline"] && status.state === "live") {
    console.error("The channel is LIVE. Stop the encoder, or run `vp run stream:stop`.");
    process.exit(1);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
