// vp run export:seed [--notes 250]    writes sample notes to the deployed table (changes AWS)
//   node scripts/seed.ts [--notes 250]
//
// Uses chapter 05's repository, so the items are what the notes API would have written.

import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { DynamoDbNoteRepository } from "@aih/example-05-dynamodb/src/dynamodb-repository.ts";
import { newNoteId } from "@aih/example-05-dynamodb/src/id.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

const STACK = "AihLongJobs";
const { values } = parseArgs({ options: { notes: { type: "string", default: "250" } } });
const notes = z.coerce.number().int().min(1).max(10_000).parse(values.notes);

try {
  const { target } = await preflight({
    access: "mutate",
    action: `write ${notes} sample notes`,
    stack: STACK,
  });
  const tableName = requireOutput(
    await readStackOutputs(process.cwd(), STACK, target.region),
    "NotesTableName",
  );
  const repository = new DynamoDbNoteRepository(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
    tableName,
  );
  const now = new Date();
  for (let number = 1; number <= notes; number++) {
    const at = new Date(now.getTime() + number);
    await repository.create(number % 2 === 0 ? "alice" : "bob", {
      id: newNoteId(at, String(number).padStart(4, "0")),
      title: `sample note ${number}`,
      body: "Written by export:seed.",
      version: 1,
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
    });
  }
  console.log(`wrote ${notes} notes to ${tableName}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
