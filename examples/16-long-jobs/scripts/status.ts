// vp run export:status                       recent executions and finished exports (reads AWS)
// vp run export:status --redrive <arn>       resumes a failed execution from the failed step (changes AWS)
//   node scripts/status.ts [--redrive <execution ARN>]

import { parseArgs } from "node:util";

import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import {
  GetExecutionHistoryCommand,
  ListExecutionsCommand,
  RedriveExecutionCommand,
  SFNClient,
} from "@aws-sdk/client-sfn";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { EXPORT_PREFIX } from "../src/job.ts";

const STACK = "AihLongJobs";
const { values } = parseArgs({ options: { redrive: { type: "string" } } });

try {
  const { target } = await preflight({
    access: values.redrive === undefined ? "observe" : "mutate",
    action:
      values.redrive === undefined ? "read executions and exports" : "redrive a failed execution",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const sfn = new SFNClient({ region: target.region });

  if (values.redrive !== undefined) {
    // Runs the failed state again with the input it had. Possible for 14 days after the failure.
    const redriven = await sfn.send(new RedriveExecutionCommand({ executionArn: values.redrive }));
    console.log(`redriven at ${redriven.redriveDate?.toISOString() ?? "?"}`);
    process.exit(0);
  }

  const { executions = [] } = await sfn.send(
    new ListExecutionsCommand({
      stateMachineArn: requireOutput(outputs, "ExportWorkflowArn"),
      maxResults: 5,
    }),
  );
  for (const execution of executions) {
    // The length of the history is what the 25,000-event limit counts.
    const history = await sfn.send(
      new GetExecutionHistoryCommand({
        executionArn: execution.executionArn,
        reverseOrder: true,
        maxResults: 1,
      }),
    );
    console.log(
      `${execution.status}  ${execution.name}  started ${execution.startDate?.toISOString() ?? "?"}  ` +
        `history events ${history.events?.[0]?.id ?? "?"}  redrives ${execution.redriveCount ?? 0}`,
    );
    if (execution.status !== "SUCCEEDED" && execution.status !== "RUNNING") {
      console.log(`  ${execution.executionArn}`);
    }
  }
  if (executions.length === 0) {
    console.log("no executions yet");
  }

  const bucket = requireOutput(outputs, "ExportsBucketName");
  const s3 = new S3Client({ region: target.region });
  // Only the first 1,000 keys: enough to see whether the latest exports have a manifest.
  const listing = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: EXPORT_PREFIX }),
  );
  const keys = (listing.Contents ?? []).flatMap((object) => object.Key ?? []);
  const exportsSeen = new Set(
    keys.map((key) => key.slice(EXPORT_PREFIX.length).split("/")[0] ?? ""),
  );
  for (const id of exportsSeen) {
    const prefix = `${EXPORT_PREFIX}${id}/`;
    const parts = keys.filter((key) => key.startsWith(`${prefix}parts/`)).length;
    console.log(
      `s3://${bucket}/${prefix}  ${parts} parts  ${keys.includes(`${prefix}manifest.json`) ? "manifest" : "no manifest"}`,
    );
  }
  if (listing.IsTruncated === true) {
    console.log("(more objects than one listing shows)");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
