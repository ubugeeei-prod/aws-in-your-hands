// vp run athena:logs:ddl --kind cloudtrail --bucket my-trail-bucket --prefix AWSLogs/111122223333/CloudTrail/ap-northeast-1
//   node scripts/log-table.ts --kind <kind> --bucket <name> [--prefix <path>] [--table <name>] [--since <day>]
// Prints the CREATE TABLE statement AWS documents for a log, filled in. Runs nothing.

import { parseArgs } from "node:util";

import * as v from "valibot";

import { LOG_KINDS, logTableDdl } from "../src/logs.ts";

try {
  const { values } = parseArgs({
    options: {
      kind: { type: "string" },
      bucket: { type: "string" },
      prefix: { type: "string", default: "" },
      table: { type: "string" },
      since: { type: "string", default: "2026-10-01" },
    },
  });
  const kind = v.parse(v.picklist(LOG_KINDS), values.kind);
  console.log(
    logTableDdl(kind, {
      bucket: values.bucket,
      prefix: values.prefix,
      table: values.table ?? `${kind.replaceAll("-", "_")}_logs`,
      since: values.since,
    }),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
