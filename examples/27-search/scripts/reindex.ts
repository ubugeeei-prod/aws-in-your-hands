// vp run search:reindex [-- --apply]
//   node scripts/reindex.ts [--apply]
//
// Compares the whole table with the whole index and prints what differs. With
// --apply it also repairs it: notes are embedded again (billed), stray vectors deleted.

import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3VectorsClient } from "@aws-sdk/client-s3vectors";
import { DynamoDBDocumentClient, paginateScan } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { createTitanEmbedder } from "../src/bedrock-embedder.ts";
import { createIndexer } from "../src/indexer.ts";
import { type OwnedNote, planReconcile, reindexNote } from "../src/reconcile.ts";
import { createS3VectorsIndex } from "../src/s3-vectors-index.ts";

const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });

const itemSchema = v.object({ ...noteSchema.entries, pk: v.string(), sk: v.string() });

try {
  const { target } = await preflight({
    access: values.apply ? "mutate" : "observe",
    action: values.apply
      ? "rebuild the vector index from the table (embeddings are billed)"
      : "compare the vector index with the table",
    stack: "AihSearch",
  });
  const outputs = await readStackOutputs(process.cwd(), "AihSearch", target.region);
  const tableName = requireOutput(outputs, "TableName");
  const documents = DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region }));
  const index = createS3VectorsIndex(
    new S3VectorsClient({ region: target.region }),
    requireOutput(outputs, "VectorIndexArn"),
  );

  // A Scan reads every item and is billed for all of them. Fine for a repair, not for a request.
  const notes: OwnedNote[] = [];
  for await (const page of paginateScan({ client: documents }, { TableName: tableName })) {
    for (const item of page.Items ?? []) {
      if (typeof item["sk"] === "string" && item["sk"].startsWith("NOTE#")) {
        const { pk, sk: _sk, ...note } = v.parse(itemSchema, item);
        notes.push({ owner: pk.slice("OWNER#".length), note });
      }
    }
  }
  const entries = [];
  for await (const entry of index.list()) {
    entries.push(entry);
  }

  const plan = planReconcile(notes, entries);
  console.log(`table: ${notes.length} note(s). index: ${entries.length} vector(s).`);
  console.log(
    `to reindex: ${plan.reindex.length} note(s). to remove: ${plan.remove.length} vector(s).`,
  );
  if (!values.apply) {
    console.log("nothing was changed. Run with --apply to repair.");
    process.exit(plan.reindex.length + plan.remove.length === 0 ? 0 : 2);
  }

  const repository = new DynamoDbNoteRepository(documents, tableName);
  const indexer = createIndexer({ embedder: createTitanEmbedder(target.region), index });
  for (const { owner, noteId } of plan.reindex) {
    const result = await reindexNote(
      { get: (o, id) => repository.get(o, id), indexer },
      owner,
      noteId,
    );
    console.log(`${result.padEnd(14)} ${owner}/${noteId}`);
  }
  if (plan.remove.length > 0) {
    await index.delete(plan.remove);
    console.log(`removed ${plan.remove.length} vector(s)`);
  }
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
