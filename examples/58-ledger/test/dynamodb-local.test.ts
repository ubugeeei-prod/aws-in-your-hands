import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vite-plus/test";

import { DynamoDbTable } from "@aih/example-30-data-modeling/src/dynamodb-table.ts";

import { audit } from "../src/audit.ts";
import { takeDigest } from "../src/digest.ts";
import { dynamoDbJournal } from "../src/dynamodb-journal.ts";
import { tableJournal } from "../src/journal.ts";
import { MemoryDigests } from "../src/memory-digests.ts";
import { describeJournalContract } from "./journal-contract.ts";
import { DAY, at, fill, freshLedger } from "./support.ts";

// An emulator on one node. Passing here says DynamoDB Local accepts the PartiQL
// statement and the queries, and refuses a second insert of the same key.
// It says nothing about IAM: DynamoDB Local checks no permissions.
const endpoint = process.env["DYNAMODB_ENDPOINT"];
const tableName = process.env["TABLE_NAME"] ?? "aih-ledger-local";

if (endpoint === undefined) {
  describe("journal contract: DynamoDB Local", () => {
    it.skip("needs DYNAMODB_ENDPOINT; run `vp run ledger:test:local`", () => {});
  });
} else {
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      endpoint,
      region: "ap-northeast-1",
      credentials: { accessKeyId: "local", secretAccessKey: "local" },
    }),
  );
  describeJournalContract("DynamoDB Local, PartiQL INSERT", async () =>
    dynamoDbJournal(client, tableName),
  );
  describeJournalContract("DynamoDB Local, conditional PutItem", async () =>
    tableJournal(new DynamoDbTable(client, tableName)),
  );

  describe("ledger on DynamoDB Local", () => {
    it("appends, digests, and audits through the PartiQL journal", async () => {
      const journal = dynamoDbJournal(client, tableName);
      const digests = new MemoryDigests({ mode: "governance", retentionMs: DAY, now: () => at(0) });
      const ledger = freshLedger();
      await fill(journal, ledger, 1, 5);
      await takeDigest(journal, digests, { ledger, now: at(9) });
      expect(await audit(journal, digests, ledger)).toEqual({
        entries: 5,
        digests: 1,
        uncovered: 0,
        findings: [],
      });
    });
  });
}
