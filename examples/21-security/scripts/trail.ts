// vp run sec:trail:iam [--hours 24]
//   node scripts/trail.ts [--hours 24]
// Lists who changed IAM recently, from CloudTrail's event history. Reads only;
// event history costs nothing and needs no trail.

import { parseArgs } from "node:util";

import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";
import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";

// IAM is a global service: its events are recorded in us-east-1, whatever Region you work in.
const IAM_EVENTS_REGION = "us-east-1";

const eventSchema = v.object({
  EventTime: v.date(),
  EventName: v.string(),
  Username: v.optional(v.string(), "(unknown)"),
  Resources: v.optional(v.array(v.object({ ResourceName: v.optional(v.string()) })), []),
});

// Number() reads the option, then: a whole number of hours, 1 to 2160 (the 90 days event history keeps).
const hoursSchema = v.pipe(
  v.string(),
  v.transform(Number),
  v.safeInteger(),
  v.minValue(1),
  v.maxValue(2160),
);

const { values } = parseArgs({ options: { hours: { type: "string", default: "24" } } });

try {
  const hours = v.parse(hoursSchema, values.hours);
  await preflight({ access: "observe", action: "look up IAM events in CloudTrail event history" });

  const response = await new CloudTrailClient({ region: IAM_EVENTS_REGION }).send(
    new LookupEventsCommand({
      LookupAttributes: [{ AttributeKey: "EventSource", AttributeValue: "iam.amazonaws.com" }],
      StartTime: new Date(Date.now() - hours * 3_600_000),
      // One page. This is a look, not an export.
      MaxResults: 50,
    }),
  );
  const changes = v
    .parse(v.array(eventSchema), response.Events ?? [])
    .filter((event) => !/^(Get|List|Generate|Simulate)/.test(event.EventName));

  for (const event of changes) {
    const names = event.Resources.map((resource) => resource.ResourceName).filter(
      (name) => name !== undefined,
    );
    console.log(
      `${event.EventTime.toISOString()}  ${event.EventName.padEnd(28)} ${event.Username}  ${names.join(", ")}`,
    );
  }
  console.log(
    `${changes.length} IAM changes in the newest ${response.Events?.length ?? 0} events of the last ${hours} h${
      response.NextToken === undefined ? "" : " (there are older events on further pages)"
    }`,
  );
  // The time is when the call was made. It says nothing about when every endpoint started enforcing it.
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
