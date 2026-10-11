import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, it } from "vite-plus/test";
import { DynamoDbNoteRepository } from "../src/dynamodb-repository.ts";
import { describeRepositoryContract } from "./repository-contract.ts";

// The same contract, against DynamoDB Local. It runs only when
// DYNAMODB_ENDPOINT is set, which `vp run test:local:dynamodb` requires.
// DynamoDB Local is an emulator: passing here shows that the expressions are
// accepted and behave as intended on one node. It does not exercise IAM,
// throttling, or the real service's replication.
const endpoint = process.env["DYNAMODB_ENDPOINT"];
const tableName = process.env["TABLE_NAME"] ?? "aih-notes-local";

if (endpoint === undefined) {
  describe("NoteRepository contract: DynamoDB Local", () => {
    it.skip("needs DYNAMODB_ENDPOINT; run `vp run test:local:dynamodb`", () => {});
  });
} else {
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint,
      region: "ap-northeast-1",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  );
  // Each test gets its own owner, so tests share the table without seeing each other's notes.
  describeRepositoryContract("DynamoDB Local", async () => ({
    repository: new DynamoDbNoteRepository(client, tableName),
    owner: `test-${randomUUID()}`,
  }));
}
