// vp run sql:db:migrate:local | sql:db:seed:local | sql:db:reset:local
//   node scripts/local-db.ts <migrate|seed|reset>
// Works on the PGlite directory only. Never opens a network connection.

import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { openPglite } from "../src/pglite.ts";
import { runMigrations, runSeed } from "./db-tasks.ts";

const dataDir = resolve(process.env["PGLITE_DATA_DIR"] ?? ".pglite");
const command = process.argv[2];

try {
  if (command !== "migrate" && command !== "seed" && command !== "reset") {
    console.error("usage: local-db.ts <migrate|seed|reset>");
    process.exit(64);
  }
  // Opening first takes the lock, so a running dev server stops a reset here.
  let db = await openPglite(dataDir);
  if (command === "reset") {
    await db.close();
    rmSync(dataDir, { recursive: true, force: true });
    console.log(`deleted ${dataDir}`);
    db = await openPglite(dataDir);
  }
  try {
    if (command !== "seed") {
      await runMigrations(db, "postgres");
    }
    if (command !== "migrate") {
      await runSeed(db);
    }
  } finally {
    await db.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
