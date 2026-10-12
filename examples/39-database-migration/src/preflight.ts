import type { Table } from "./catalog.ts";

// #region findings
export type Finding = {
  table: string;
  code:
    | "no-primary-key"
    | "lob-primary-key"
    | "unbounded-key-for-validation"
    | "lob-column"
    | "sequence";
  /** A blocker must be fixed before the task starts. A note must be handled by the cutover. */
  severity: "blocker" | "note";
  detail: string;
};

// The AWS DMS type table for a PostgreSQL source maps these to NCLOB, CLOB, or BLOB.
const lobTypes = new Set(["text", "json", "jsonb", "xml", "bytea"]);
// #endregion findings

// #region preflight
/**
 * The limits the AWS DMS documentation states for a PostgreSQL source, checked
 * against a catalog. It reads no data and replaces no premigration assessment.
 */
export function preflight(tables: Table[]): Finding[] {
  const findings: Finding[] = [];
  for (const table of tables) {
    const name = `${table.schema}.${table.name}`;
    const add = (code: Finding["code"], severity: Finding["severity"], detail: string): void =>
      void findings.push({ table: name, code, severity, detail });
    const column = (columnName: string) => table.columns.find((c) => c.name === columnName);

    if (table.primaryKey.length === 0) {
      add(
        "no-primary-key",
        "blocker",
        "UPDATE and DELETE are ignored during CDC, re-applied INSERTs double, and data validation cannot run",
      );
    }
    for (const key of table.primaryKey) {
      const type = column(key)?.type ?? "";
      if (lobTypes.has(type)) {
        add("lob-primary-key", "blocker", `${key} is ${type}, which is migrated as a LOB`);
      } else if (type === "character varying" && (column(key)?.maxLength ?? 1024) >= 1024) {
        add(
          "unbounded-key-for-validation",
          "note",
          `${key} is a varchar with no length under 1024, so data validation cannot use it`,
        );
      }
    }
    const lobs = table.columns.filter(
      (c) => lobTypes.has(c.type) && !table.primaryKey.includes(c.name),
    );
    if (lobs.length > 0) {
      add(
        "lob-column",
        "note",
        `${lobs.map((c) => c.name).join(", ")}: longer than LobMaxSize is truncated in limited LOB mode`,
      );
    }
    const generated = table.columns.filter((c) => c.generated);
    if (generated.length > 0) {
      add(
        "sequence",
        "note",
        `${generated.map((c) => c.name).join(", ")}: the sequence is not migrated and must be advanced at cutover`,
      );
    }
  }
  return findings;
}
// #endregion preflight
