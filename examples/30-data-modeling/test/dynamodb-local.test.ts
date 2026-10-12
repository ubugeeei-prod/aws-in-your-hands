import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, it } from "vite-plus/test";

import { DynamoDbTable } from "../src/dynamodb-table.ts";
import { describeNotebookContract } from "./notebook-contract.ts";
import { describeTableContract } from "./table-contract.ts";

// An emulator on one node. Passing here says the expressions are accepted and
// behave as the model does. It says nothing about IAM, throttling, how far an
// index lags, or transactions that collide: DynamoDB Local never reports a conflict.
const endpoint = process.env["DYNAMODB_ENDPOINT"];
const tableName = process.env["TABLE_NAME"] ?? "aih-modeling-local";

if (endpoint === undefined) {
  describe("contracts: DynamoDB Local", () => {
    it.skip("needs DYNAMODB_ENDPOINT; run `vp run modeling:test:local`", () => {});
  });
} else {
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint,
      region: "ap-northeast-1",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  );
  const open = async () => new DynamoDbTable(client, tableName);
  describeTableContract("DynamoDB Local", open);
  describeNotebookContract("DynamoDB Local", open);
}
