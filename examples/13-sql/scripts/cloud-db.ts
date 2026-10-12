// vp run sql:db:migrate | sql:db:grant | sql:db:seed
//   node scripts/cloud-db.ts <migrate|grant|seed>
// Connects to the deployed cluster as `admin`, with your own AWS credentials
// (they need dsql:DbConnectAdmin on the cluster). Changes the database. Billed.

import * as v from "valibot";

import { preflight } from "@aih/tools/aws/preflight.ts";
import { readStackOutputs, requireOutput } from "@aih/tools/infra/outputs.ts";

import { type Db, type Queryable, rows } from "../src/db.ts";
import { openDsql } from "../src/dsql.ts";
import { regionOfEndpoint } from "../src/env.ts";
import { grantStatements } from "../src/grant.ts";
import { isSerializationFailure } from "../src/transaction.ts";
import { runMigrations, runSeed } from "./db-tasks.ts";

const STACK = "AihSql";
const DATABASE_ROLE = "notes_api";
const command = process.argv[2];

// A schema change made a moment ago can make the next statement fail once with
// SQLSTATE 40001 (OC001). Everything here is safe to run again.
async function retrying<T>(what: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (!isSerializationFailure(error) || attempt === 3) {
        throw error;
      }
      console.error(`${what}: conflict (SQLSTATE 40001), running it again`);
    }
  }
}

const present = v.object({ present: v.literal(1) });
const exists = async (connection: Queryable, text: string, params: string[]): Promise<boolean> =>
  (await rows(connection, present, text, params)).length > 0;

async function grant(db: Db, iamRoleArn: string): Promise<void> {
  const statements = grantStatements(DATABASE_ROLE, iamRoleArn);
  await db.withConnection(async (connection) => {
    if (
      !(await exists(connection, "SELECT 1 AS present FROM pg_roles WHERE rolname = $1", [
        DATABASE_ROLE,
      ]))
    ) {
      await retrying("create role", () => connection.query(statements.createRole));
      console.log(`created database role ${DATABASE_ROLE}`);
    }
    const mapped = await exists(
      connection,
      "SELECT 1 AS present FROM sys.iam_pg_role_mappings WHERE pg_role_name = $1 AND arn = $2",
      [DATABASE_ROLE, iamRoleArn],
    );
    if (!mapped) {
      await retrying("map to IAM", () => connection.query(statements.mapToIam));
      console.log(`${iamRoleArn} may now connect as ${DATABASE_ROLE}`);
    }
    for (const statement of statements.privileges) {
      await retrying("grant", () => connection.query(statement));
      console.log(statement);
    }
  });
}

try {
  if (command !== "migrate" && command !== "grant" && command !== "seed") {
    console.error("usage: cloud-db.ts <migrate|grant|seed>");
    process.exit(64);
  }
  const { target } = await preflight({
    access: "mutate",
    action: `${command} the notes database`,
    stack: STACK,
  });
  const outputs = await readStackOutputs(process.cwd(), STACK, target.region);
  const endpoint = requireOutput(outputs, "ClusterEndpoint");
  if (regionOfEndpoint(endpoint) !== target.region) {
    throw new Error(`The cluster endpoint ${endpoint} is not in ${target.region}.`);
  }
  console.error(`cluster: ${endpoint} (as admin)`);

  const db = openDsql({
    endpoint,
    region: target.region,
    user: "admin",
    onPoolError: (error) => console.error(`idle connection lost: ${error.message}`),
  });
  try {
    switch (command) {
      case "migrate":
        await retrying("migrate", () => runMigrations(db, "dsql"));
        break;
      case "grant":
        await grant(db, requireOutput(outputs, "HandlerRoleArn"));
        break;
      case "seed":
        await runSeed(db);
        break;
    }
  } finally {
    await db.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
