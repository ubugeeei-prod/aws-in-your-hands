// vp run sec:trail:iam [--hours 24]
//   node scripts/trail.ts [--hours 24]
// Lists who changed IAM recently, from CloudTrail's event history. Reads only;
// event history costs nothing and needs no trail.
import { parseArgs } from "node:util";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";
import { z } from "zod";

// IAM is a global service: its events are recorded in us-east-1, whatever Region you work in.
const IAM_EVENTS_REGION = "us-east-1";

const eventSchema = z.object({
  EventTime: z.date(),
  EventName: z.string(),
  Username: z.string().default("(unknown)"),
  Resources: z.array(z.object({ ResourceName: z.string().optional() })).default([]),
});

const { values } = parseArgs({ options: { hours: { type: "string", default: "24" } } });

try {
  const hours = z.coerce.number().int().min(1).max(2160).parse(values.hours);
  await preflight({ access: "observe", action: "look up IAM events in CloudTrail event history" });

  const response = await new CloudTrailClient({ region: IAM_EVENTS_REGION }).send(
    new LookupEventsCommand({
      LookupAttributes: [{ AttributeKey: "EventSource", AttributeValue: "iam.amazonaws.com" }],
      StartTime: new Date(Date.now() - hours * 3_600_000),
      // One page. This is a look, not an export.
      MaxResults: 50,
    }),
  );
  const changes = z
    .array(eventSchema)
    .parse(response.Events ?? [])
    .filter((event) => !/^(Get|List|Generate|Simulate)/.test(event.EventName));

  for (const event of changes) {
    const names = event.Resources.map((resource) => resource.ResourceName).filter((name) => name !== undefined);
    console.log(
      `${event.EventTime.toISOString()}  ${event.EventName.padEnd(28)} ${event.Username}  ${names.join(", ")}`,
    );
  }
  console.log(
    `${changes.length} IAM changes in the newest ${response.Events?.length ?? 0} events of the last ${hours} h` +
      (response.NextToken === undefined ? "" : " (there are older events on further pages)"),
  );
  // The time is when the call was made. It says nothing about when every endpoint started enforcing it.
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
