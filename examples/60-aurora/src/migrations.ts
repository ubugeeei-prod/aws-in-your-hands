import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadMigrations, type Migration } from "@aih/example-13-sql/src/migrate.ts";

/** Chapter 13's four migrations, then this chapter's one. The numbers keep them in order. */
export function allMigrations(): Migration[] {
  const chapter13 = dirname(
    createRequire(import.meta.url).resolve("@aih/example-13-sql/package.json"),
  );
  return [
    join(chapter13, "migrations"),
    fileURLToPath(new URL("../migrations", import.meta.url)),
  ].flatMap(loadMigrations);
}
