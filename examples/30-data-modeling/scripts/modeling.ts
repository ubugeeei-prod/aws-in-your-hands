// vp run modeling:smoke | modeling:backfill | modeling:verify | modeling:remove-legacy
//   node scripts/modeling.ts <smoke|backfill|verify|remove-legacy> [--apply] [--table name] [--after pk,sk]
// Reads or changes the deployed table with your own credentials. `backfill`
// and `remove-legacy` only report what they would do unless --apply is given.

import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

import { newNoteId } from "@aih/example-05-dynamodb/src/id.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { jitteredBackoff } from "../src/compose.ts";
import { DynamoDbTable } from "../src/dynamodb-table.ts";
import { backfill, removeLegacy, verify } from "../src/migration.ts";
import { createNotebook } from "../src/notebook.ts";

const STACK = "AihModeling";
const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    apply: { type: "boolean", default: false },
    // A table other than this stack's: the one chapters 05 to 08 filled.
    table: { type: "string" },
    // Where an interrupted backfill stopped, as it printed it.
    after: { type: "string" },
  },
});
const [command] = positionals;
const changes = command === "smoke" || (flags.apply && command !== "verify");

async function connect(action: string): Promise<DynamoDbTable> {
  const { target } = await preflight({
    access: changes ? "mutate" : "observe",
    action,
    stack: STACK,
  });
  const tableName =
    flags.table ??
    requireOutput(await readStackOutputs(process.cwd(), STACK, target.region), "TableName");
  console.log(`table: ${tableName} (${target.region})`);
  return new DynamoDbTable(
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: target.region })),
    tableName,
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls for something that arrives later, and says how long it took to show up. */
async function waitFor(what: string, check: () => Promise<boolean>): Promise<void> {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > 60_000) {
      throw new Error(`${what}: not seen after 60 s`);
    }
    await sleep(250);
  }
  console.log(`ok   ${what} (seen after ${Date.now() - started} ms, polled every 250 ms)`);
}

// #region smoke
async function smoke(): Promise<void> {
  const table = await connect("write, read and delete one note in the chapter 30 table");
  const notebook = createNotebook({ table, backoff: jitteredBackoff });
  const owner = `smoke-${randomBytes(4).toString("hex")}`;
  const now = new Date();
  const id = newNoteId(now, randomBytes(5).toString("hex"));
  const stamp = now.toISOString();
  const tag = "smoke";

  const created = await notebook.create(owner, {
    id,
    title: "smoke",
    body: "v1",
    version: 1,
    createdAt: stamp,
    updatedAt: stamp,
    tags: [tag],
    slug: `smoke-${id}`,
  });
  console.log(`ok   create: ${created}`);
  const attached = await notebook.attach(owner, {
    id: newNoteId(now, randomBytes(5).toString("hex")),
    noteId: id,
    contentType: "image/png",
    size: 1,
    createdAt: stamp,
  });
  console.log(`ok   attach: ${attached}`);

  const found = await notebook.getWithAttachments(owner, id);
  if (found?.attachments.length !== 1) {
    throw new Error("the note did not come back with its one attachment");
  }
  console.log("ok   one Query returned the note and its attachment");
  console.log(`ok   count: ${await notebook.count(owner)}`);

  // The two things that are allowed to be late.
  await waitFor("the note in the recent list (index)", async () =>
    (await notebook.listRecent(owner, { limit: 5 })).notes.some((item) => item.id === id),
  );
  await waitFor(
    "the tag count (stream consumer)",
    async () => (await notebook.tagCount(owner, tag)) === 1,
  );

  await notebook.remove(owner, id);
  if ((await notebook.getWithAttachments(owner, id)) !== undefined) {
    throw new Error("the note is still there after remove");
  }
  await waitFor("the tag count back at 0", async () => (await notebook.tagCount(owner, tag)) === 0);
  console.log(
    `ok   removed. Left behind on purpose: the counters under OWNER#${owner}, and the stream consumer's markers until their TTL.`,
  );
}
// #endregion smoke

function parseAfter(): { pk: string; sk: string } | undefined {
  if (flags.after === undefined) {
    return undefined;
  }
  const [pk, sk] = flags.after.split(",");
  if (pk === undefined || sk === undefined) {
    throw new Error("--after takes pk,sk as the last run printed it");
  }
  return { pk, sk };
}

try {
  switch (command) {
    case "smoke":
      await smoke();
      break;
    case "backfill": {
      const table = await connect("add index attributes to old notes and copy old attachment keys");
      let next = parseAfter();
      do {
        // A page at a time, so the place to resume from is printed as the run goes.
        const report = await backfill(table, {
          pageSize: 100,
          maxPages: 1,
          after: next,
          dryRun: !flags.apply,
        });
        next = report.next;
        console.log(
          `scanned ${report.scanned}, ${flags.apply ? "wrote" : "would write"} ${report.written}, skipped ${report.skipped}${next === undefined ? "" : `, resume with --after '${next.pk},${next.sk}'`}`,
        );
      } while (next !== undefined);
      if (!flags.apply) {
        console.log("\nNothing was changed. Run the same command with --apply to do it.");
      }
      break;
    }
    case "verify": {
      const missing = await verify(await connect("check that every old item has its new form"));
      for (const key of missing) {
        console.log(`missing  ${key.pk}  ${key.sk}`);
      }
      console.log(`${missing.length} missing`);
      process.exitCode = missing.length === 0 ? 0 : 1;
      break;
    }
    case "remove-legacy": {
      const table = await connect("delete old attachment keys whose copy exists");
      const result = await removeLegacy(table, { pageSize: 100, dryRun: !flags.apply });
      console.log(
        `${flags.apply ? "removed" : "would remove"} ${result.removed}, kept ${result.kept} (no copy under the new key)`,
      );
      break;
    }
    default:
      console.error("usage: modeling.ts <smoke|backfill|verify|remove-legacy> [--apply]");
      process.exitCode = 64;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
