// vp run ledger:append | ledger:digest | ledger:verify | ledger:purge
//   node scripts/ledger.ts <append|digest|verify|purge> [--apply] [--bucket name]
// Reads or changes the deployed ledger with your own credentials. `purge`
// only reports what it would delete unless --apply is given, and never
// bypasses a lock: a version still under retention is left where it is.

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteBucketCommand,
  DeleteObjectCommand,
  GetObjectRetentionCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { audit } from "../src/audit.ts";
import { takeDigest } from "../src/digest.ts";
import { dynamoDbJournal } from "../src/dynamodb-journal.ts";
import { encodeEvent } from "../src/events.ts";
import { append } from "../src/ledger.ts";
import { type HeldVersion, purgePlan } from "../src/purge.ts";
import { S3Digests } from "../src/s3-digests.ts";

const STACK = "AihLedger";
const LEDGER = "notes";
const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: "boolean", default: false },
    // The digest bucket outlives the stack, and with it the stack's outputs.
    bucket: { type: "string" },
  },
});
const [command] = positionals;
const changes =
  command === "append" || command === "digest" || (command === "purge" && flags.apply);

async function connect(action: string, needs: { table: boolean }) {
  const { target } = await preflight({
    access: changes ? "mutate" : "observe",
    action,
    stack: STACK,
  });
  const outputs =
    needs.table || flags.bucket === undefined
      ? await readStackOutputs(process.cwd(), STACK, target.region)
      : {};
  const bucket = flags.bucket ?? requireOutput(outputs, "DigestBucketName");
  const s3 = new S3Client({ region: target.region });
  console.log(`bucket: ${bucket} (${target.region})`);
  return {
    s3,
    bucket,
    digests: new S3Digests(s3, bucket),
    journal: needs.table
      ? dynamoDbJournal(
          DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
          requireOutput(outputs, "TableName"),
        )
      : undefined,
  };
}

async function appendOne(): Promise<void> {
  const { journal } = await connect("append one sample entry to the chapter 58 ledger", {
    table: true,
  });
  if (journal === undefined) {
    throw new Error("No table.");
  }
  const event = encodeEvent({
    type: "note.created",
    noteId: `smoke-${randomBytes(4).toString("hex")}`,
    actor: "ledger:append",
    version: 1,
  });
  const entry = await append(journal, { ledger: LEDGER, event, now: new Date() });
  console.log(`appended entry ${entry.seq} (${entry.hash})`);
}

async function digestNow(): Promise<void> {
  const { journal, digests } = await connect("lock a digest of the chapter 58 ledger", {
    table: true,
  });
  if (journal === undefined) {
    throw new Error("No table.");
  }
  // The scheduled function does exactly this, once an hour, with its own role.
  const result = await takeDigest(journal, digests, { ledger: LEDGER, now: new Date() });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.kind === "refused" ? 1 : 0;
}

async function verify(): Promise<void> {
  const { journal, digests } = await connect("read the chapter 58 ledger and its digests", {
    table: true,
  });
  if (journal === undefined) {
    throw new Error("No table.");
  }
  const result = await audit(journal, digests, LEDGER);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.findings.length === 0 ? 0 : 1;
}

// #region purge
async function purge(): Promise<void> {
  const { s3, bucket, digests } = await connect(
    "delete the digest versions whose lock has ended, then the bucket if it is empty",
    { table: false },
  );
  const held: HeldVersion[] = [];
  for (const version of await digests.list("")) {
    const retainUntil = version.deleteMarker
      ? undefined
      : await s3
          .send(
            new GetObjectRetentionCommand({
              Bucket: bucket,
              Key: version.key,
              VersionId: version.versionId,
            }),
          )
          .then((result) => result.Retention?.RetainUntilDate)
          .catch((error: unknown) => {
            // A version written with no retention at all has no configuration to return.
            if (
              error instanceof S3ServiceException &&
              error.name === "NoSuchObjectLockConfiguration"
            ) {
              return undefined;
            }
            throw error;
          });
    held.push({ ...version, ...(retainUntil === undefined ? {} : { retainUntil }) });
  }

  const plan = purgePlan(held, new Date());
  console.log(`${plan.deletable.length} version(s) can be deleted, ${plan.locked.length} locked`);
  if (plan.emptyAfter !== undefined) {
    console.log(`the last lock ends at ${plan.emptyAfter.toISOString()}; run this again after it`);
  }
  if (!flags.apply) {
    console.log("nothing was deleted. Pass --apply to delete.");
    return;
  }
  for (const version of plan.deletable) {
    // No BypassGovernanceRetention: S3 refuses this request for a version still locked.
    await s3.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: version.key, VersionId: version.versionId }),
    );
  }
  if (plan.locked.length === 0) {
    await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
    console.log(`deleted bucket ${bucket}`);
  }
}
// #endregion purge

try {
  switch (command) {
    case "append":
      await appendOne();
      break;
    case "digest":
      await digestNow();
      break;
    case "verify":
      await verify();
      break;
    case "purge":
      await purge();
      break;
    default:
      console.error("usage: ledger.ts <append|digest|verify|purge> [--apply] [--bucket name]");
      process.exitCode = 64;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
