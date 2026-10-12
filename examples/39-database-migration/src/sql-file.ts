import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Queryable } from "@aih/example-13-sql/src/db.ts";

export const sqlDirectory = fileURLToPath(new URL("../sql", import.meta.url));

/** The statements of one file. Good for plain DDL only: it splits on every `;` at a line end. */
export function statementsOf(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");
}

/** Runs every `.sql` file of a directory under `sql/`, in name order. */
export async function runSqlDirectory(
  connection: Queryable,
  name: string,
  only?: (file: string) => boolean,
): Promise<void> {
  const directory = join(sqlDirectory, name);
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => only?.(file) ?? true)
    .toSorted();
  for (const file of files) {
    for (const statement of statementsOf(readFileSync(join(directory, file), "utf8"))) {
      await connection.query(statement);
    }
  }
}
