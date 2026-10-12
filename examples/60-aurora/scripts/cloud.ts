// vp run aurora:db:schema | aurora:smoke
//   node scripts/cloud.ts <schema|smoke>
// Reaches the deployed cluster through the RDS Data API with your own AWS
// credentials. Changes the database, and wakes a paused instance. Billed.

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { lintMigration, statementFor } from "@aih/example-13-sql/src/migrate.ts";
import { backoffMs, type RetryPolicy } from "@aih/example-13-sql/src/transaction.ts";
import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { appendResultSchema, appendToNote } from "../src/append.ts";
import { AURORA_STACK, DATABASE_NAME } from "../src/config.ts";
import { createDataApiClient, dataApi } from "../src/data-api.ts";
import { classify } from "../src/failure.ts";
import { allMigrations } from "../src/migrations.ts";
import { createOnce, type Transactional } from "../src/once.ts";

// Long enough for an instance that was paused for more than a day to resume.
const policy: RetryPolicy = { maxAttempts: 8, baseDelayMs: 2_000, maxDelayMs: 10_000 };

// Every statement here may run twice without harm (IF NOT EXISTS, ON CONFLICT),
// so it is simply sent again. The append below is the one that may not.
async function again<T>(what: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (classify(error) !== "connection" || attempt >= policy.maxAttempts) {
        throw error;
      }
      console.error(`${what}: no outcome (${String(error)}), trying again`);
      await sleep(backoffMs(attempt, policy, Math.random));
    }
  }
}

async function schema(database: Transactional): Promise<void> {
  const migrations = allMigrations();
  const problems = migrations.flatMap(lintMigration);
  if (problems.length > 0) {
    throw new Error(`Refusing to apply:\n  ${problems.join("\n  ")}`);
  }
  // No record of what was applied: each file is one statement that can run
  // again. Chapter 13's runner, which keeps the record, needs a session.
  for (const migration of migrations) {
    await again(migration.name, () =>
      database.transaction((tx) => tx.query(statementFor("postgres", migration))),
    );
    console.log(`applied ${migration.name}`);
  }
}

async function smoke(database: Transactional): Promise<void> {
  const owner = `smoke-${randomUUID()}`;
  const id = randomUUID();
  const now = new Date().toISOString();
  await again("seed", () =>
    database.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO app.owners (owner, note_count) VALUES ($1, 1) ON CONFLICT (owner) DO NOTHING",
        [owner],
      );
      await tx.query(
        `INSERT INTO app.notes (id, owner, title, body, version, created_at, updated_at)
         VALUES (CAST($1 AS uuid), $2, 'smoke', 'a', 1, CAST($3 AS timestamptz), CAST($3 AS timestamptz))
         ON CONFLICT (id) DO NOTHING`,
        [id, owner, now],
      );
    }),
  );

  const once = createOnce({
    database,
    policy,
    now: () => new Date(),
    sleep: (ms) => sleep(ms),
    random: Math.random,
    onRetry: ({ attempt, failure }) => console.error(`attempt ${attempt}: ${failure}, retrying`),
  });
  const request = { owner, key: randomUUID(), result: appendResultSchema };
  const append = () =>
    once(request, (tx) => appendToNote(tx, { owner, id, text: "b", at: new Date() }));
  try {
    const first = await append();
    const second = await append();
    console.log(`first:  ${JSON.stringify(first)}`);
    console.log(`second: ${JSON.stringify(second)}`);
    if (first.status !== "appended" || first.version !== 2 || first.length !== 2) {
      throw new Error("The first call did not append once.");
    }
    if (JSON.stringify(second) !== JSON.stringify(first)) {
      throw new Error("The same key appended again, or answered differently.");
    }
    console.log("ok   the same key applied once and answered the same twice");
  } finally {
    await again("cleanup", () =>
      database.transaction(async (tx) => {
        await tx.query("DELETE FROM app.requests WHERE owner = $1", [owner]);
        await tx.query("DELETE FROM app.notes WHERE owner = $1", [owner]);
        await tx.query("DELETE FROM app.owners WHERE owner = $1", [owner]);
      }),
    );
  }
}

const tasks = { schema, smoke };
const command = process.argv[2];

try {
  if (command !== "schema" && command !== "smoke") {
    throw new Error("usage: node scripts/cloud.ts <schema|smoke>");
  }
  const { target } = await preflight({
    access: "mutate",
    action:
      command === "schema" ? "apply the schema through the Data API" : "smoke test the cluster",
    stack: AURORA_STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), AURORA_STACK, target.region);
  const database = dataApi(createDataApiClient(target.region), {
    resourceArn: requireOutput(outputs, "ClusterArn"),
    secretArn: requireOutput(outputs, "SecretArn"),
    database: DATABASE_NAME,
  });
  await tasks[command](database);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
