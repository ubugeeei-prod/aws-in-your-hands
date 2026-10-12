// vp run modeling:db:migrate:local | modeling:db:reset:local
//   node scripts/local-db.ts <migrate|reset>
// Creates this chapter's table in DynamoDB Local, with its index. Refuses any
// endpoint that is not on this machine. The emulator itself is started by
// chapter 05's `db:local:start`; this table sits beside chapter 05's in it.

import {
  CreateTableCommand,
  DeleteTableCommand,
  ResourceInUseException,
  ResourceNotFoundException,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb";

import { createClient } from "../src/compose.ts";
import { parseEnv } from "../src/env.ts";
import { INDEX, INDEX_PK, INDEX_PROJECTION, INDEX_SK } from "../src/keys.ts";

const env = parseEnv({
  TABLE_NAME: process.env["TABLE_NAME"] ?? "aih-modeling-local",
  DYNAMODB_ENDPOINT: process.env["DYNAMODB_ENDPOINT"] ?? "http://localhost:8000",
});
const { hostname } = new URL(env.DYNAMODB_ENDPOINT ?? "");
if (hostname !== "localhost" && hostname !== "127.0.0.1") {
  console.error(
    `DYNAMODB_ENDPOINT is ${env.DYNAMODB_ENDPOINT}. These tasks only ever touch a local emulator.`,
  );
  process.exit(1);
}
const client = createClient(env);

// #region create-table
// Kept in step by hand with the table in infra/lib/modeling-stack.ts.
async function migrate(): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: env.TABLE_NAME,
        BillingMode: "PAY_PER_REQUEST",
        // Only key attributes are declared: of the table, and of the index.
        AttributeDefinitions: ["pk", "sk", INDEX_PK, INDEX_SK].map((AttributeName) => ({
          AttributeName,
          AttributeType: "S",
        })),
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: INDEX,
            KeySchema: [
              { AttributeName: INDEX_PK, KeyType: "HASH" },
              { AttributeName: INDEX_SK, KeyType: "RANGE" },
            ],
            Projection: { ProjectionType: "INCLUDE", NonKeyAttributes: INDEX_PROJECTION },
          },
        ],
        StreamSpecification: { StreamEnabled: true, StreamViewType: "KEYS_ONLY" },
      }),
    );
    await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: env.TABLE_NAME });
    console.log(`created table ${env.TABLE_NAME} with index ${INDEX}`);
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) {
      throw error;
    }
    console.log(`table ${env.TABLE_NAME} already exists`);
  }
}
// #endregion create-table

async function drop(): Promise<void> {
  try {
    await client.send(new DeleteTableCommand({ TableName: env.TABLE_NAME }));
    await waitUntilTableNotExists({ client, maxWaitTime: 30 }, { TableName: env.TABLE_NAME });
    console.log(`deleted table ${env.TABLE_NAME}`);
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  }
}

try {
  switch (process.argv[2]) {
    case "migrate":
      await migrate();
      break;
    case "reset":
      await drop();
      await migrate();
      break;
    default:
      console.error("usage: local-db.ts <migrate|reset>");
      process.exitCode = 64;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`Is DynamoDB Local running at ${env.DYNAMODB_ENDPOINT}?`);
  process.exitCode = 1;
}
