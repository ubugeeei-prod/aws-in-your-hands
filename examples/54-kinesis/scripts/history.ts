// vp run kinesis:history                 what the function derived for note "demo" (reads AWS)
// vp run kinesis:history -- --note n2
//   node scripts/history.ts [--note <id>]

import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { DynamoDbHistoryStore } from "../src/dynamodb-history.ts";
import { missingOf } from "../src/history.ts";

const STACK = "AihKinesis";
const { values } = parseArgs({ options: { note: { type: "string", default: "demo" } } });

try {
  const { target } = await preflight({
    access: "observe",
    action: "read one note's history",
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const store = new DynamoDbHistoryStore(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
    requireOutput(outputs, "HistoryTableName"),
  );
  const history = await store.get(values.note);
  console.log(
    history === undefined
      ? `nothing applied for note ${values.note} yet`
      : `${history.noteId}: version ${history.version}, from ${history.revisions} revisions, ` +
          `missing ${missingOf(history)}${history.deleted ? ", deleted" : ""}, last change ${history.updatedAt}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
