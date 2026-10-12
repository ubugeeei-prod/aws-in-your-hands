// vp run recovery:<command>   The drill of chapter 22, one step per command.
//   node scripts/recovery.ts <command> [--apply] [--table NAME] [--at ISO] [--frozen] [--fence]
//
// Commands that change AWS print what they would do and stop, unless --apply
// is given. All of them run with your credentials.

import {
  DeleteTableCommand,
  DescribeContinuousBackupsCommand,
  DescribeTableCommand,
  ListTablesCommand,
  RestoreTableToPointInTimeCommand,
  UpdateContinuousBackupsCommand,
} from "@aws-sdk/client-dynamodb";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { GetBucketVersioningCommand, PutObjectCommand } from "@aws-sdk/client-s3";

import { createNoteService } from "@aih/example-05-dynamodb/src/notes.ts";
import {
  createAttachmentService,
  withAttachmentCleanup,
} from "@aih/example-07-uploads/api/src/attachments.ts";
import { KEY_PREFIX, objectKey } from "@aih/example-07-uploads/api/src/keys.ts";
import { SWEEP_GRACE_MS } from "@aih/example-07-uploads/api/src/sweep.ts";

import { audit, auditSchema } from "../src/audit.ts";
import { SEVERITY, takeSnapshot } from "../src/invariants.ts";
import { restoreObjects } from "../src/object-restore.ts";
import { type ContinuousBackups, planTableRestore, RESTORED_MARK } from "../src/pitr.ts";
import { repair } from "../src/repair.ts";
import { diffTables, fenceVersions } from "../src/table-diff.ts";
import {
  type Context,
  connect,
  flags,
  pointInTime,
  positionals,
  remindToApply,
  verb,
} from "./context.ts";

// Everything the drill writes belongs to this owner, and `accident` deletes nothing else.
const OWNER = "drill";
const SEED_TITLES = ["trip to Kyoto", "ramen recipe", "reading list"];

// The first bytes of a PNG that declares 3x2 pixels: enough for chapter 08's
// inspection, which reads the header and decodes nothing. Not a viewable image.
function seedImage(): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, 3);
  new DataView(bytes.buffer).setUint32(20, 2);
  return bytes;
}

async function backupsOf(context: Context, tableName: string): Promise<ContinuousBackups> {
  const result = await context.dynamodb.send(
    new DescribeContinuousBackupsCommand({ TableName: tableName }),
  );
  const pitr = result.ContinuousBackupsDescription?.PointInTimeRecoveryDescription;
  return {
    enabled: pitr?.PointInTimeRecoveryStatus === "ENABLED",
    earliestRestorable: pitr?.EarliestRestorableDateTime,
    latestRestorable: pitr?.LatestRestorableDateTime,
  };
}

async function describe(context: Context, tableName: string): Promise<void> {
  const { Table: table } = await context.dynamodb.send(
    new DescribeTableCommand({ TableName: tableName }),
  );
  const backups = await backupsOf(context, tableName);
  console.log(`table ${tableName}`);
  console.log(`  status:               ${table?.TableStatus ?? "unknown"}`);
  console.log(
    `  deletion protection:  ${table?.DeletionProtectionEnabled === true ? "on" : "off"}`,
  );
  console.log(`  point-in-time:        ${backups.enabled ? "on" : "off"}`);
  console.log(`  earliest restorable:  ${backups.earliestRestorable?.toISOString() ?? "-"}`);
  console.log(`  latest restorable:    ${backups.latestRestorable?.toISOString() ?? "-"}`);
}

// #region status
async function status(): Promise<void> {
  const context = await connect("show what can be restored", { change: false });
  await describe(context, context.ownedTable);
  if (context.activeTable !== context.ownedTable) {
    console.log("\nThe function reads a different table from the one the stack owns:");
    await describe(context, context.activeTable);
  }

  const versioning = await context.s3.send(
    new GetBucketVersioningCommand({ Bucket: context.bucketName }),
  );
  console.log(
    `bucket ${context.bucketName}\n  versioning:           ${versioning.Status ?? "never enabled"}`,
  );

  // Restored tables are not in the stack, so no stack output and no drift check knows them.
  let start: string | undefined;
  const restored: string[] = [];
  do {
    const page = await context.dynamodb.send(
      new ListTablesCommand({ ExclusiveStartTableName: start }),
    );
    restored.push(
      ...(page.TableNames ?? []).filter((name) =>
        name.startsWith(`${context.ownedTable}${RESTORED_MARK}`),
      ),
    );
    start = page.LastEvaluatedTableName;
  } while (start !== undefined);
  console.log(`\nrestored tables outside the stack: ${restored.length}`);
  for (const name of restored) {
    await describe(context, name);
  }
}
// #endregion status

async function seed(): Promise<void> {
  const context = await connect("write the drill's notes and images", { change: true });
  const store = context.open(context.activeTable);
  console.log(
    `${verb(context.dryRun, "wrote", "would write")} ${SEED_TITLES.length} notes with one image each,`,
  );
  console.log(`owner "${OWNER}", into ${store.tableName} and ${context.bucketName}`);
  if (!context.dryRun) {
    let counter = 0;
    const notes = createNoteService({
      repository: store.notes,
      now: () => new Date(),
      randomSuffix: () => String(++counter).padStart(4, "0"),
    });
    const image = seedImage();
    for (const title of SEED_TITLES) {
      const note = await notes.create(OWNER, { title, body: "written by recovery:seed" });
      const attachmentId = `${note.id}-img`;
      const key = objectKey({ owner: OWNER, noteId: note.id, attachmentId });
      const put = await context.s3.send(
        new PutObjectCommand({
          Bucket: context.bucketName,
          Key: key,
          Body: image,
          ContentType: "image/png",
        }),
      );
      // Chapter 07's order: the object first, then the record that points at it.
      await store.attachments.create(OWNER, {
        id: attachmentId,
        noteId: note.id,
        contentType: "image/png",
        size: image.byteLength,
        createdAt: new Date().toISOString(),
      });
      // No worker runs in this stack, so the drill writes the record a worker
      // would. The sequencer is made up; S3's would be later than this one.
      await store.inspections.putIfNewer(OWNER, {
        noteId: note.id,
        attachmentId,
        sequencer: "1".padStart(32, "0"),
        eTag: (put.ETag ?? "").replaceAll('"', ""),
        size: image.byteLength,
        declaredType: "image/png",
        verdict: "ok",
        width: 3,
        height: 2,
        inspectedAt: new Date().toISOString(),
      });
      console.log(`  ${note.id}  ${title}`);
    }
    console.log(
      `\nseeded at ${new Date().toISOString()}. Wait until "latest restorable" in recovery:status is later than this.`,
    );
  }
  remindToApply(context.dryRun);
}

// #region accident
async function accident(): Promise<void> {
  const context = await connect("delete one drill note and damage one drill image", {
    change: true,
  });
  const store = context.open(context.activeTable);
  const log = () => {};
  const plain = createNoteService({
    repository: store.notes,
    now: () => new Date(),
    randomSuffix: () => "",
  });
  const attachments = createAttachmentService({
    notes: plain,
    attachments: store.attachments,
    objects: context.objects,
    now: () => new Date(),
    randomSuffix: () => "",
    log,
  });
  // The app's own delete, cascade included: this is what a user's mistake runs.
  const notes = withAttachmentCleanup(plain, attachments, log);

  const page = await notes.list(OWNER, { limit: 100 });
  const [damaged, deleted] = page.notes;
  if (damaged === undefined || deleted === undefined) {
    throw new Error(
      `Fewer than two notes of owner "${OWNER}" in ${store.tableName}. Run recovery:seed first.`,
    );
  }
  console.log(`before the accident: ${new Date().toISOString()}`);
  console.log(
    `${verb(context.dryRun, "deleted", "would delete")} note ${deleted.id} ("${deleted.title}") and its images`,
  );
  if (!context.dryRun) {
    await notes.remove(OWNER, deleted.id);
  }
  for (const image of await store.attachments.listByNote(OWNER, damaged.id)) {
    const key = objectKey({ owner: OWNER, noteId: damaged.id, attachmentId: image.id });
    console.log(
      `${verb(context.dryRun, "overwrote", "would overwrite")} ${key} with bytes that are not an image`,
    );
    if (!context.dryRun) {
      await context.s3.send(
        new PutObjectCommand({
          Bucket: context.bucketName,
          Key: key,
          Body: "overwritten by recovery:accident",
          ContentType: "image/png",
        }),
      );
    }
  }
  console.log(`after the accident:  ${new Date().toISOString()}`);
  remindToApply(context.dryRun);
}
// #endregion accident

// #region restore-table
async function restoreTable(): Promise<void> {
  const context = await connect("restore the table to a point in time, as a new table", {
    change: true,
  });
  const plan = planTableRestore({
    sourceTableName: context.ownedTable,
    backups: await backupsOf(context, context.ownedTable),
    at: pointInTime(),
    now: new Date(),
  });
  if (!plan.ok) {
    throw new Error(plan.reason);
  }
  const point = plan.input.RestoreDateTime?.toISOString() ?? "the latest restorable time";
  console.log(
    `${verb(context.dryRun, "restoring", "would restore")} ${context.ownedTable} as of ${point}`,
  );
  console.log(`into a new table: ${plan.targetTableName}`);
  if (!context.dryRun) {
    await context.dynamodb.send(new RestoreTableToPointInTimeCommand(plan.input));
    console.log(
      `requested at ${new Date().toISOString()}. The source table is untouched and stays in use.`,
    );
    console.log(`Watch it with: vp run recovery:status   (ACTIVE means the restore is done)`);
  }
  remindToApply(context.dryRun);
}
// #endregion restore-table

/** A restore does not carry these over. The restored table starts without either. */
async function protect(): Promise<void> {
  const context = await connect("turn on point-in-time recovery for a restored table", {
    change: true,
  });
  const tableName = requireRestored(context, "protect");
  console.log(
    `${verb(context.dryRun, "turned on", "would turn on")} point-in-time recovery for ${tableName}`,
  );
  if (!context.dryRun) {
    await context.dynamodb.send(
      new UpdateContinuousBackupsCommand({
        TableName: tableName,
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
      }),
    );
  }
  remindToApply(context.dryRun);
}

async function restoreObjectsCommand(): Promise<void> {
  const context = await connect("bring the bucket's keys back to a point in time", {
    change: true,
  });
  const point = pointInTime();
  if (point === undefined) {
    throw new Error("restore-objects needs --at <time>: the moment whose bytes you want back.");
  }
  const plan = await restoreObjects(context.bucket, {
    prefix: KEY_PREFIX,
    point,
    dryRun: context.dryRun,
  });
  for (const step of plan.steps) {
    const what =
      step.type === "remove_delete_marker"
        ? "the delete marker removed"
        : "the old version copied on top";
    console.log(
      `${verb(context.dryRun, "done", "planned")}: ${step.key}, ${what} (${step.versionId})`,
    );
  }
  for (const key of plan.newerThanPoint) {
    console.log(`left alone: ${key} did not exist at ${point.toISOString()}`);
  }
  console.log(
    `${plan.steps.length} steps, ${plan.newerThanPoint.length} newer keys left alone, ${plan.unchanged} unchanged`,
  );
  remindToApply(context.dryRun);
}

// #region diff
async function diff(): Promise<void> {
  const context = await connect("compare the live table with a restored one", {
    change: flags.fence,
  });
  const restoredName = requireRestored(context, "diff");
  const live = await takeSnapshot(context.open(context.activeTable).table, context.bucket);
  const restored = context.open(restoredName);
  const result = diffTables(live, await takeSnapshot(restored.table, context.bucket));

  console.log(`cutting over from ${context.activeTable} to ${restoredName}:`);
  console.log(
    `  gives back ${result.returning.length} notes and ${result.attachmentsReturning} attachment records`,
  );
  console.log(
    `  loses      ${result.lost.length} notes and ${result.attachmentsLost} attachment records created since`,
  );
  console.log(`  undoes     edits to ${result.rolledBack.length} notes`);
  for (const note of result.lost) {
    console.log(`  lost:        ${note.owner}/${note.noteId}`);
  }
  for (const note of result.rolledBack) {
    console.log(
      `  rolled back: ${note.owner}/${note.noteId} version ${note.liveVersion} -> ${note.restoredVersion}`,
    );
  }
  if (flags.fence) {
    const fences = await fenceVersions(restored.table, result, { dryRun: context.dryRun });
    for (const fence of fences) {
      console.log(
        `${verb(context.dryRun, "raised", "would raise")} ${fence.owner}/${fence.noteId} to version ${fence.to}`,
      );
    }
    remindToApply(context.dryRun);
  }
}
// #endregion diff

async function verify(): Promise<void> {
  const context = await connect("check the invariants of chapters 05, 07, and 08", {
    change: false,
  });
  const { tableName, table } = context.chosen();
  const result = await audit(
    { tableName, table, bucket: context.bucket, now: () => new Date() },
    { graceMs: flags.frozen ? 0 : SWEEP_GRACE_MS },
  );
  const { report, ...summary } = result;
  for (const finding of report.findings) {
    console.log(`${SEVERITY[finding.kind]}  ${JSON.stringify(finding)}`);
  }
  console.log(JSON.stringify(summary, null, 2));
  if (summary.broken > 0) {
    // Leftovers are for cleanup to deal with. Broken means: do not cut over yet.
    process.exitCode = 1;
  }
}

async function repairCommand(): Promise<void> {
  const context = await connect("repair what the check found", { change: true });
  const store = context.chosen();
  const { report } = await audit(
    {
      tableName: store.tableName,
      table: store.table,
      bucket: context.bucket,
      now: () => new Date(),
    },
    { graceMs: flags.frozen ? 0 : SWEEP_GRACE_MS },
  );
  const result = await repair(
    {
      bucket: context.bucket,
      attachments: store.attachments,
      inspections: store.inspections,
      reader: context.reader,
      now: () => new Date(),
    },
    report.findings,
    { dryRun: context.dryRun },
  );
  for (const item of result.repaired) {
    console.log(
      `${verb(context.dryRun, "done", "planned")}: ${item.key} ${item.finding} -> ${item.action}`,
    );
  }
  for (const finding of result.left) {
    console.log(`left for you: ${JSON.stringify(finding)}`);
  }
  console.log(
    `${result.repaired.length} repairs, ${result.left.length} findings left. Run recovery:verify again.`,
  );
  remindToApply(context.dryRun);
}

/** Asks the deployed function, which reads whatever table the stack points it at. */
async function auditCommand(): Promise<void> {
  const context = await connect("invoke the audit function", { change: false });
  const response = await new LambdaClient({ region: context.region }).send(
    new InvokeCommand({ FunctionName: context.auditFunctionName }),
  );
  const payload = new TextDecoder().decode(response.Payload);
  if (response.FunctionError !== undefined) {
    throw new Error(`The audit function failed: ${payload}`);
  }
  const summary = auditSchema.parse(JSON.parse(payload));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`confirmed at ${new Date().toISOString()}: the function reads ${summary.tableName}`);
  if (summary.broken > 0) {
    process.exitCode = 1;
  }
}

function requireRestored(context: Context, command: string): string {
  const name = flags.table;
  if (name === undefined) {
    throw new Error(`${command} needs --table <the restored table>. recovery:status lists them.`);
  }
  if (!name.includes(RESTORED_MARK) || name === context.ownedTable) {
    throw new Error(
      `${name} is not a table this drill restored (no "${RESTORED_MARK}" in its name).`,
    );
  }
  return name;
}

// #region drop-table
async function dropTable(): Promise<void> {
  const context = await connect("delete a restored table", { change: true });
  const tableName = requireRestored(context, "drop-table");
  if (tableName === context.activeTable) {
    throw new Error(
      `${tableName} is the table the function reads now. Cut back to another table first.`,
    );
  }
  console.log(
    `${verb(context.dryRun, "deleting", "would delete")} table ${tableName} and everything in it`,
  );
  if (!context.dryRun) {
    await context.dynamodb.send(new DeleteTableCommand({ TableName: tableName }));
  }
  remindToApply(context.dryRun);
}
// #endregion drop-table

/** A versioned bucket is empty only when every version and every delete marker is gone. */
async function empty(): Promise<void> {
  const context = await connect("delete every version of every object in the uploads bucket", {
    change: true,
  });
  let count = 0;
  for await (const version of context.bucket.listVersions("")) {
    count++;
    if (!context.dryRun) {
      await context.bucket.removeVersion(version.key, version.versionId);
    }
  }
  console.log(
    `${verb(context.dryRun, "deleted", "would delete")} ${count} versions and delete markers in ${context.bucketName}`,
  );
  console.log("After this, nothing in the bucket can be brought back.");
  remindToApply(context.dryRun);
}

const commands: Record<string, () => Promise<void>> = {
  status,
  seed,
  accident,
  "restore-table": restoreTable,
  protect,
  "restore-objects": restoreObjectsCommand,
  diff,
  verify,
  repair: repairCommand,
  audit: auditCommand,
  "drop-table": dropTable,
  empty,
};

const command = commands[positionals[0] ?? ""];
if (command === undefined) {
  console.error(
    `usage: recovery.ts <${Object.keys(commands).join("|")}> [--apply] [--table NAME] [--at ISO]`,
  );
  process.exit(64);
}
try {
  await command();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
