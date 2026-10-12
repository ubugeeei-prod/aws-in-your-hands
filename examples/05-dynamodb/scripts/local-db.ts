// vp run db:local:start | db:migrate:local | db:seed:local | db:reset:local | db:local:stop
//   node scripts/local-db.ts <start|migrate|seed|reset|stop>
// `start` and `stop` need a Docker daemon, which the Nix shell does not provide.
// Every command refuses to run unless the endpoint is a localhost URL.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  ResourceNotFoundException,
  waitUntilTableExists,
  waitUntilTableNotExists,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { noteSchema } from "../src/contract.ts";
import { DynamoDbNoteRepository } from "../src/dynamodb-repository.ts";
import { SHARED_OWNER } from "../src/notes.ts";

const CONTAINER = "aih-dynamodb-local";
// Pinned by tag. `latest` pointed at the same image when this was written (2026-10-11).
const IMAGE = "amazon/dynamodb-local:3.3.1";

const endpoint = process.env["DYNAMODB_ENDPOINT"] ?? "http://localhost:8000";
const tableName = process.env["TABLE_NAME"] ?? "aih-notes-local";
const { hostname, port } = new URL(endpoint);
if (hostname !== "localhost" && hostname !== "127.0.0.1") {
  console.error(`DYNAMODB_ENDPOINT is ${endpoint}. These tasks only ever touch a local emulator.`);
  process.exit(1);
}

const client = new DynamoDBClient({
  endpoint,
  region: "ap-northeast-1",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});

function docker(...args: string[]): number {
  console.error(`$ docker ${args.join(" ")}`);
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.error !== undefined) {
    console.error(
      "The docker command is not available. Install Docker and start its daemon; the Nix shell does not include it.",
    );
    return 1;
  }
  return result.status ?? 1;
}

// Kept in step by hand with the table in infra/lib/notes-stack.ts.
async function migrate(): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
      }),
    );
    await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
    console.log(`created table ${tableName}`);
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) {
      throw error;
    }
    console.log(`table ${tableName} already exists`);
  }
}

async function drop(): Promise<void> {
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    await waitUntilTableNotExists({ client, maxWaitTime: 30 }, { TableName: tableName });
    console.log(`deleted table ${tableName}`);
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) {
      throw error;
    }
  }
}

async function seed(): Promise<void> {
  const fixture = z
    .array(noteSchema)
    .parse(
      JSON.parse(
        readFileSync(new URL("../test/fixtures/seed-notes.json", import.meta.url), "utf8"),
      ),
    );
  const repository = new DynamoDbNoteRepository(DynamoDBDocumentClient.from(client), tableName);
  let created = 0;
  for (const note of fixture) {
    if ((await repository.create(SHARED_OWNER, note)) === "created") {
      created++;
    }
  }
  console.log(`seeded ${created} note(s); ${fixture.length - created} already present`);
}

try {
  switch (process.argv[2]) {
    case "start":
      process.exitCode = docker(
        "run",
        "--detach",
        "--name",
        CONTAINER,
        "--publish",
        `127.0.0.1:${port}:8000`,
        IMAGE,
        "-jar",
        "DynamoDBLocal.jar",
        "-inMemory",
        "-sharedDb",
      );
      break;
    case "stop":
      process.exitCode = docker("rm", "--force", CONTAINER);
      break;
    case "migrate":
      await migrate();
      break;
    case "seed":
      await seed();
      break;
    case "reset":
      await drop();
      await migrate();
      await seed();
      break;
    default:
      console.error("usage: local-db.ts <start|migrate|seed|reset|stop>");
      process.exitCode = 64;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(
    `Is DynamoDB Local running at ${endpoint}? Start it with \`vp run db:local:start\`.`,
  );
  process.exitCode = 1;
}
