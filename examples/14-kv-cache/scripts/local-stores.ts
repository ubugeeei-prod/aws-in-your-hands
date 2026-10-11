// vp run kv:local:start | kv:local:migrate | kv:local:stop
//   node scripts/local-stores.ts <start|migrate|stop>
// `start` and `stop` need a Docker daemon, which the Nix shell does not provide.
// Every command refuses to run unless both endpoints are on this machine.
import { spawnSync } from "node:child_process";
import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";

const VALKEY_CONTAINER = "aih-kv-valkey";
const DYNAMODB_CONTAINER = "aih-kv-dynamodb-local";
// Pinned by tag. 9.0 is the line ElastiCache Serverless needs for a public endpoint.
const VALKEY_IMAGE = "valkey/valkey:9.0.6-alpine";
const DYNAMODB_IMAGE = "amazon/dynamodb-local:3.3.1";

const valkeyUrl = new URL(process.env["VALKEY_URL"] ?? "valkey://localhost:6390");
const dynamoDbEndpoint = process.env["DYNAMODB_ENDPOINT"] ?? "http://localhost:8001";
const tableName = process.env["TABLE_NAME"] ?? "aih-kv-local";
const dynamoDbUrl = new URL(dynamoDbEndpoint);

for (const url of [valkeyUrl, dynamoDbUrl]) {
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    console.error(`${url.href} is not on this machine. These tasks only ever touch local containers.`);
    process.exit(1);
  }
}

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

// Kept in step by hand with the table in infra/lib/kv-cache-stack.ts. No TTL
// setting here: the stores never rely on DynamoDB having deleted anything.
async function migrate(): Promise<void> {
  const client = new DynamoDBClient({
    endpoint: dynamoDbEndpoint,
    region: "ap-northeast-1",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
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

try {
  switch (process.argv[2]) {
    case "start": {
      const valkey = docker(
        "run",
        "--detach",
        "--name",
        VALKEY_CONTAINER,
        "--publish",
        `127.0.0.1:${valkeyUrl.port || "6379"}:6379`,
        VALKEY_IMAGE,
      );
      const dynamoDb = docker(
        "run",
        "--detach",
        "--name",
        DYNAMODB_CONTAINER,
        "--publish",
        `127.0.0.1:${dynamoDbUrl.port}:8000`,
        DYNAMODB_IMAGE,
        "-jar",
        "DynamoDBLocal.jar",
        "-inMemory",
        "-sharedDb",
      );
      process.exitCode = valkey || dynamoDb;
      break;
    }
    case "stop":
      process.exitCode = docker("rm", "--force", VALKEY_CONTAINER, DYNAMODB_CONTAINER);
      break;
    case "migrate":
      await migrate();
      break;
    default:
      console.error("usage: local-stores.ts <start|migrate|stop>");
      process.exitCode = 64;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(`Is DynamoDB Local running at ${dynamoDbEndpoint}? Start it with \`vp run kv:local:start\`.`);
  process.exitCode = 1;
}
