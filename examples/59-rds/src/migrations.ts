import { fileURLToPath } from "node:url";

import { loadMigrations, type Migration } from "@aih/example-13-sql/src/migrate.ts";

/** Chapter 13's migration files, found through the dependency on its package. */
export const chapter13Migrations = (): Migration[] =>
  loadMigrations(
    fileURLToPath(
      new URL("../migrations", import.meta.resolve("@aih/example-13-sql/src/migrate.ts")),
    ),
  );
