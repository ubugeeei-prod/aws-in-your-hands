// vp run mr:status              both Regions as they are now (reads AWS)
// vp run mr:conflict            what the two-Region edit would do; --apply runs it (changes AWS)
// vp run mr:empty               counts object versions in both buckets; --apply deletes them
//   node scripts/mr.ts <status|conflict|empty> [--apply]
//
// None of these was run while the chapter was written.

import { parseArgs } from "node:util";

import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetBucketReplicationCommand, S3Client } from "@aws-sdk/client-s3";
import * as v from "valibot";

import { noteSchema } from "@aih/example-05-dynamodb/src/contract.ts";
import { S3VersionedBucket } from "@aih/example-22-recovery/src/s3-versioned-bucket.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { HEALTH_PATH, REGION_HEADER } from "../src/regional-app.ts";
import {
  PRIMARY_REGION,
  type Region,
  REGIONS,
  STANDBY_REGION,
  TABLE_NAME,
} from "../src/regions.ts";

const STACKS: Record<Region, string> = {
  [PRIMARY_REGION]: "AihMultiRegion",
  [STANDBY_REGION]: "AihMultiRegionStandby",
};

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { apply: { type: "boolean", default: false } },
});

async function connect(action: string, change: boolean) {
  await preflight({ access: change ? "mutate" : "observe", action });
  const sites = await Promise.all(
    REGIONS.map(async (region) => {
      const outputs = await readStackOutputs(process.cwd(), STACKS[region], region);
      return {
        region,
        apiUrl: requireOutput(outputs, "ApiUrl"),
        bucket: requireOutput(outputs, "UploadsBucketName"),
      };
    }),
  );
  return sites;
}

// #region status
async function status(): Promise<void> {
  for (const site of await connect("read both Regions", false)) {
    console.log(`\n${site.region}`);
    const table = await new DynamoDBClient({ region: site.region }).send(
      new DescribeTableCommand({ TableName: TABLE_NAME }),
    );
    console.log(`  table: ${table.Table?.TableStatus}`);
    for (const replica of table.Table?.Replicas ?? []) {
      console.log(`    replica in ${replica.RegionName}: ${replica.ReplicaStatus}`);
    }
    try {
      const replication = await new S3Client({ region: site.region }).send(
        new GetBucketReplicationCommand({ Bucket: site.bucket }),
      );
      for (const rule of replication.ReplicationConfiguration?.Rules ?? []) {
        console.log(`  bucket rule ${rule.ID}: ${rule.Status} -> ${rule.Destination?.Bucket}`);
      }
    } catch (error) {
      // Osaka's bucket has no rule until it is deployed with -c back=on.
      console.log(`  bucket: no replication rule (${error instanceof Error ? error.name : error})`);
    }
    const health = await fetch(`${site.apiUrl}${HEALTH_PATH}`, {
      signal: AbortSignal.timeout(5000),
    });
    console.log(`  GET ${HEALTH_PATH}: ${health.status} ${await health.text()}`);
  }
}
// #endregion status

// #region conflict
/** The lost update of the tests, against the real table: two PUTs of version 1, one per Region. */
async function conflict(): Promise<void> {
  const sites = await connect("edit one note in both Regions at once", flags.apply);
  const [tokyo, osaka] = sites;
  if (tokyo === undefined || osaka === undefined) {
    throw new Error("Both stacks must be deployed.");
  }
  if (!flags.apply) {
    console.log(
      "Would create one note in Tokyo, edit it in both Regions at once, report which edit\n" +
        "survived, and delete it. Nothing was written. Pass --apply to run it.",
    );
    return;
  }
  const json = { "content-type": "application/json" };
  const created = await fetch(`${tokyo.apiUrl}/notes`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({ title: "conflict probe" }),
  });
  const { id } = v.parse(noteSchema, await created.json());

  // Wait until Osaka has the note; otherwise its PUT would answer 404.
  const startedAt = Date.now();
  while ((await fetch(`${osaka.apiUrl}/notes/${id}`)).status !== 200) {
    if (Date.now() - startedAt > 30_000) {
      throw new Error("The note did not reach Osaka within 30 s.");
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  console.log(`replicated to Osaka after at most ${Date.now() - startedAt} ms`);

  const put = (site: typeof tokyo, title: string) =>
    fetch(`${site.apiUrl}/notes/${id}`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify({ title, body: "", expectedVersion: 1 }),
    });
  const answers = await Promise.all([put(tokyo, "edited in Tokyo"), put(osaka, "edited in Osaka")]);
  for (const answer of answers) {
    console.log(`PUT -> ${answer.status} from ${answer.headers.get(REGION_HEADER)}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));
  for (const site of sites) {
    const note = v.parse(noteSchema, await (await fetch(`${site.apiUrl}/notes/${id}`)).json());
    console.log(`${site.region} holds "${note.title}", version ${note.version}`);
  }
  await fetch(`${tokyo.apiUrl}/notes/${id}`, { method: "DELETE" });
}
// #endregion conflict

async function empty(): Promise<void> {
  for (const site of await connect("delete every object version in both buckets", flags.apply)) {
    const bucket = new S3VersionedBucket(new S3Client({ region: site.region }), site.bucket);
    let count = 0;
    for await (const version of bucket.listVersions("")) {
      count++;
      if (flags.apply) {
        await bucket.removeVersion(version.key, version.versionId);
      }
    }
    console.log(
      `${site.bucket}: ${count} versions and delete markers${flags.apply ? ", deleted" : ""}`,
    );
  }
  if (!flags.apply) {
    console.log("Nothing was deleted. Pass --apply to delete them; they cannot be brought back.");
  }
}

try {
  const commands: Record<string, () => Promise<void>> = { status, conflict, empty };
  const command = commands[positionals[0] ?? ""];
  if (command === undefined) {
    throw new Error(`usage: mr.ts <${Object.keys(commands).join("|")}> [--apply]`);
  }
  await command();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
