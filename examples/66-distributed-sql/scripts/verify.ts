// vp run distsql:local:verify
//   node scripts/verify.ts
//
// Drives the running local cluster through the chapter's claims and prints what
// it saw: chapter 13's migrations and repository unchanged, a real commit
// conflict handled by chapter 13's retry loop, the loss of one node, and the
// loss of two. Kills and restarts local processes. Loopback only; no AWS.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import pg from "pg";
import * as v from "valibot";

import type { Note } from "@aih/example-13-sql/src/contract.ts";
import { type Db, rows } from "@aih/example-13-sql/src/db.ts";
import { loadMigrations, migrate } from "@aih/example-13-sql/src/migrate.ts";
import { SqlNoteRepository } from "@aih/example-13-sql/src/notes-repository.ts";
import {
  createTransactionRunner,
  defaultRetryPolicy,
} from "@aih/example-13-sql/src/transaction.ts";

import type { Endpoint } from "../src/failover.ts";
import { fullyReplicated, healthSchema } from "../src/remote.ts";
import { NODE_NAMES, type NodeName, nodeOf } from "../src/topology.ts";
import { openYugabyte } from "../src/yugabyte-db.ts";
import {
  binariesPresent,
  certsDir,
  crash,
  currentCluster,
  home,
  pidOf,
  runDir,
  start,
  tls,
} from "./local-nodes.ts";

const cluster = currentCluster();
// With TLS the cluster also asks for a password. A new cluster has the documented default one.
const secure = tls()
  ? { ca: readFileSync(`${certsDir}/ca.crt`, "utf8"), password: "yugabyte" }
  : {};

const endpointOf = (node: NodeName): Endpoint => ({
  host: nodeOf(cluster, node).address,
  port: nodeOf(cluster, node).ports.ysql,
});
const open = (nodes: readonly NodeName[], onSkip?: (endpoint: Endpoint) => void): Db =>
  openYugabyte({
    endpoints: nodes.map(endpointOf),
    database: "yugabyte",
    user: "yugabyte",
    ...secure,
    onSkip: ({ endpoint }) => onSkip?.(endpoint),
  });

const run = `verify-${Date.now()}`;
let failed = false;
function check(what: string, ok: boolean, detail = ""): void {
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"}  ${what}${detail === "" ? "" : `  (${detail})`}`);
}

function noteFor(index: number): Note {
  const at = new Date().toISOString();
  return {
    id: randomUUID(),
    title: `note ${index}`,
    body: "",
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
}

const idSchema = v.object({ id: v.string() });
async function storedIds(db: Db, owner: string): Promise<Set<string>> {
  const found = await db.withConnection((connection) =>
    rows(connection, idSchema, "SELECT id FROM app.notes WHERE owner = $1", [owner]),
  );
  return new Set(found.map((row) => row.id));
}

async function waitForYsql(node: NodeName, timeoutMs: number): Promise<number> {
  const started = Date.now();
  for (;;) {
    try {
      await open([node]).withConnection((connection) => connection.query("SELECT 1"));
      return Date.now() - started;
    } catch (error) {
      if (Date.now() - started > timeoutMs) {
        throw new Error(`node ${node} did not accept SQL within ${timeoutMs} ms`, { cause: error });
      }
      await sleep(500);
    }
  }
}

/** Asks the masters until one says nothing is dead and every tablet has all its copies. */
async function waitFullyReplicated(timeoutMs: number): Promise<number> {
  const started = Date.now();
  for (;;) {
    for (const node of NODE_NAMES) {
      const { address, ports } = nodeOf(cluster, node);
      try {
        const response = await fetch(`http://${address}:${ports.masterWeb}/api/v1/health-check`);
        const health = v.safeParse(healthSchema, await response.json());
        if (health.success && fullyReplicated(health.output)) {
          return Date.now() - started;
        }
      } catch {
        // This master is down or not the leader. Ask the next one.
      }
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`not fully replicated within ${timeoutMs} ms`);
    }
    await sleep(1000);
  }
}

function repositoryOn(db: Db, quota: number, retries: { count: number }): SqlNoteRepository {
  const transaction = createTransactionRunner({
    db,
    policy: defaultRetryPolicy,
    sleep: (ms) => sleep(ms),
    random: Math.random,
    onRetry: () => void retries.count++,
  });
  return new SqlNoteRepository(transaction, quota);
}

if (!binariesPresent() || NODE_NAMES.some((node) => pidOf(node, "tserver") === undefined)) {
  console.error(
    "Every node must be running. `vp run distsql:fetch`, then `vp run distsql:local:start`.",
  );
  process.exit(1);
}

// #region same-code
console.log("\n-- chapter 13's migrations and repository, unchanged");
const serverSchema = v.object({ host: v.string(), port: v.number(), zone: v.string() });
const all = open(NODE_NAMES);
await all.withConnection(async (connection) => {
  const [version] = await rows(connection, v.object({ version: v.string() }), "SELECT version()");
  console.log(`    ${version?.version}`);
  const servers = await rows(
    connection,
    serverSchema,
    "SELECT host, port::integer AS port, zone FROM yb_servers() ORDER BY port",
  );
  check("three tablet servers, one per zone", new Set(servers.map((s) => s.zone)).size === 3);
  const migrations = loadMigrations(
    fileURLToPath(new URL("../../13-sql/migrations", import.meta.url)),
  );
  // "postgres": the runner drops DSQL's ASYNC keyword, as it does for PGlite.
  const first = await migrate(connection, migrations, {
    dialect: "postgres",
    now: () => new Date(),
    sleep: (ms) => sleep(ms),
    log: () => undefined,
  });
  console.log(`    applied now: ${first.applied.length} of ${migrations.length}`);
});

if (tls()) {
  const plain = new pg.Client({
    ...endpointOf("a"),
    database: "yugabyte",
    user: "yugabyte",
    password: "yugabyte",
    ssl: false,
  });
  plain.on("error", () => undefined);
  const refused = await plain.connect().then(
    () => false,
    () => true,
  );
  await plain.end().catch(() => undefined);
  check("a client without TLS is refused", refused);
}

const quiet = { count: 0 };
const notes = repositoryOn(all, 100, quiet);
const owner = `${run}-basic`;
const original = noteFor(0);
check("create", (await notes.create(owner, original)) === "created");
check(
  "create again with the same id leaves one note",
  (await notes.create(owner, original)) === "created" && (await storedIds(all, owner)).size === 1,
);
const updated = await notes.update(owner, original.id, {
  title: "second",
  body: "",
  expectedVersion: 1,
  updatedAt: new Date().toISOString(),
});
check(
  "update moves the version from 1 to 2",
  updated.status === "updated" && updated.note.version === 2,
);
const stale = await notes.update(owner, original.id, {
  title: "third",
  body: "",
  expectedVersion: 1,
  updatedAt: new Date().toISOString(),
});
check("an update from a stale version is a conflict, not a write", stale.status === "conflict");
// #endregion same-code

// #region conflict
console.log("\n-- a quota of 3, and 12 creates at once through three nodes");
const retries = { count: 0 };
const contended = `${run}-quota`;
const perNode = NODE_NAMES.map((node) => repositoryOn(open([node]), 3, retries));
const outcomes = await Promise.allSettled(
  Array.from({ length: 12 }, (_, index) =>
    perNode[index % perNode.length]?.create(contended, noteFor(index)),
  ),
);
const created = outcomes.filter((o) => o.status === "fulfilled" && o.value === "created").length;
const refused = outcomes.filter(
  (o) => o.status === "fulfilled" && o.value === "quota_exceeded",
).length;
const exhausted = outcomes.filter((o) => o.status === "rejected").length;
const counted = await all.withConnection((connection) =>
  rows(
    connection,
    v.object({ n: v.number() }),
    "SELECT note_count AS n FROM app.owners WHERE owner = $1",
    [contended],
  ),
);
const stored = (await storedIds(all, contended)).size;
console.log(
  `    created ${created}, quota_exceeded ${refused}, gave up after ${defaultRetryPolicy.maxAttempts} attempts ${exhausted}, retries after SQLSTATE 40001: ${retries.count}`,
);
check(
  "the quota held: note_count and the rows agree, and neither passed 3",
  stored <= 3 && counted[0]?.n === stored,
  `note_count ${counted[0]?.n}, rows ${stored}`,
);
check("every acknowledged create is stored", created === stored);
check("at least one transaction lost a commit and was retried", retries.count > 0);
// #endregion conflict

// #region one-node
console.log("\n-- one node lost");
const durable = `${run}-durable`;
const acknowledged: string[] = [];
const writer = repositoryOn(all, 1000, quiet);
for (let index = 0; index < 20; index++) {
  const note = noteFor(index);
  if ((await writer.create(durable, note)) === "created") {
    acknowledged.push(note.id);
  }
}
crash("b");
const skipped: string[] = [];
const survivors = open(["b", "a", "c"], (endpoint) =>
  skipped.push(`${endpoint.host}:${endpoint.port}`),
);
const afterCrash = repositoryOn(survivors, 1000, quiet);
const firstTry = Date.now();
let errorsAfterCrash = 0;
for (let index = 20; index < 40; index++) {
  const note = noteFor(index);
  // The same id until it is acknowledged: create is idempotent, so an answer that was lost costs nothing.
  for (;;) {
    try {
      if ((await afterCrash.create(durable, note)) === "created") {
        acknowledged.push(note.id);
      }
      break;
    } catch (error) {
      errorsAfterCrash++;
      if (Date.now() - firstTry > 120_000) {
        throw error;
      }
      await sleep(250);
    }
  }
}
console.log(
  `    20 more creates took ${Date.now() - firstTry} ms; errors that were retried with the same id: ${errorsAfterCrash}; connections refused by the dead node: ${skipped.length}`,
);
for (const node of ["a", "c"] as const) {
  const seen = await storedIds(open([node]), durable);
  check(
    `node ${node} serves all ${acknowledged.length} acknowledged notes with b down`,
    acknowledged.every((id) => seen.has(id)),
  );
}
start("b");
console.log(`    node b accepted SQL again after ${await waitForYsql("b", 180_000)} ms`);
const seenByB = await storedIds(open(["b"]), durable);
// Any node answers any statement by asking the tablet leaders, so this alone says little about b's own copies.
check(
  "node b, back, answers with the notes written while it was down",
  acknowledged.every((id) => seenByB.has(id)),
);
console.log(
  `    the masters reported no dead node and no under-replicated tablet after ${await waitFullyReplicated(180_000)} ms`,
);
// #endregion one-node

// #region two-nodes
console.log("\n-- two nodes lost");
crash("b");
crash("c");
const alone = open(["a"]);
const unacknowledged = noteFor(99);
const attempt = await Promise.race([
  repositoryOn(alone, 1000, quiet)
    .create(durable, unacknowledged)
    .then(
      (result) => `answered ${result}`,
      (error: unknown) =>
        `error: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`,
    ),
  sleep(20_000).then(() => "no answer in 20 s"),
]);
console.log(`    a create through the one node left: ${attempt}`);
check("one node of three does not acknowledge a write", !attempt.startsWith("answered created"));
start("b");
start("c");
await waitForYsql("b", 180_000);
await waitForYsql("c", 180_000);
await waitFullyReplicated(180_000);
const final = await storedIds(open(["c", "b", "a"]), durable);
check(
  "with the majority back, every acknowledged note is still there",
  acknowledged.every((id) => final.has(id)),
  `${acknowledged.length} acknowledged, ${final.size} stored`,
);
console.log(
  `    the create that was never acknowledged is ${final.has(unacknowledged.id) ? "stored" : "not stored"}`,
);
// #endregion two-nodes

// #region dump
console.log("\n-- a logical backup, restored into a second database");
const pgEnv = {
  ...process.env,
  PGHOST: endpointOf("a").host,
  PGPORT: String(endpointOf("a").port),
  PGUSER: "yugabyte",
  ...(tls()
    ? { PGPASSWORD: "yugabyte", PGSSLMODE: "verify-ca", PGSSLROOTCERT: `${certsDir}/ca.crt` }
    : {}),
};
const tool = (name: string, args: string[]): string =>
  execFileSync(`${home}/postgres/bin/${name}`, args, {
    env: pgEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
// Just after a majority returns, a statement can still fail once while leaders settle.
// Each step here is safe to repeat: the dump only reads, and every attempt restores into a new database.
async function backupAndRestore(): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const name = `restore_${Date.now()}`;
    try {
      writeFileSync(dumpFile, tool("ysql_dump", ["--no-owner", "--dbname", "yugabyte"]));
      tool("ysqlsh", ["--dbname", "yugabyte", "--command", `CREATE DATABASE ${name}`]);
      tool("ysqlsh", ["--dbname", name, "--quiet", "--set", "ON_ERROR_STOP=1", "--file", dumpFile]);
      return name;
    } catch (error) {
      const stderr = v.safeParse(v.object({ stderr: v.string() }), error);
      const reason = stderr.success ? stderr.output.stderr.split("\n")[0] : String(error);
      console.log(`    attempt ${attempt} failed: ${reason}`);
      if (attempt >= 5) {
        throw new Error("the backup could not be taken and restored in 5 attempts", {
          cause: error,
        });
      }
      await sleep(3000);
    }
  }
}
const dumpFile = `${runDir}/backup.sql`;
const copy = await backupAndRestore();
const restored = openYugabyte({
  endpoints: [endpointOf("c")],
  database: copy,
  user: "yugabyte",
  ...secure,
});
const inCopy = await storedIds(restored, durable);
check(
  "the restored copy holds every acknowledged note",
  acknowledged.every((id) => inCopy.has(id)),
  `${inCopy.size} rows of this owner`,
);
tool("ysqlsh", ["--dbname", "yugabyte", "--command", `DROP DATABASE ${copy}`]);
// #endregion dump

console.log(failed ? "\nFAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
