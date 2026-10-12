// vp run search:seed
//   node scripts/seed.ts
//
// Writes the notes in fixtures/notes.json to the deployed table, with your own
// credentials. The stream carries them to the indexer, which embeds them (billed).

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import seed from "../fixtures/notes.json" with { type: "json" };

const seedSchema = v.object({
  notes: v.array(
    v.object({ owner: v.string(), id: v.string(), title: v.string(), body: v.string() }),
  ),
});

try {
  const { target } = await preflight({
    access: "mutate",
    action: "write the seed notes to the table (the indexer then embeds them, billed)",
    stack: "AihSearch",
  });
  const tableName = requireOutput(
    await readStackOutputs(process.cwd(), "AihSearch", target.region),
    "TableName",
  );
  const repository = new DynamoDbNoteRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
    tableName,
  );
  const now = new Date().toISOString();
  for (const { owner, id, title, body } of v.parse(seedSchema, seed).notes) {
    // A conditional write: running this twice changes nothing, and sends no second stream record.
    const result = await repository.create(owner, {
      id,
      title,
      body,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`${result.padEnd(14)} ${owner}/${id} ${title}`);
  }
} catch (error) {
  console.error("FAIL", error instanceof Error ? error.message : error);
  process.exit(1);
}
