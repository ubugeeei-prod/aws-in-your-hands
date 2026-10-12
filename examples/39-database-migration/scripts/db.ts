// The same checks the tests run on PGlite, against two real PostgreSQL
// databases. Reads only, except `sequences --apply`, which moves the target's
// sequences. Run it from a machine that can reach both databases.

import pg from "pg";
import * as v from "valibot";

import type { Queryable } from "@aih/example-13-sql/src/db.ts";

import { type Table, readCatalog } from "../src/catalog.ts";
import { preflight } from "../src/preflight.ts";
import { applySequences, planSequences } from "../src/sequences.ts";
import { resolveMappings, tableMappings } from "../src/table-mappings.ts";
import { compareTables, missingSecondaryObjects } from "../src/verify.ts";

const databaseUrl = v.pipe(v.string(), v.url(), v.regex(/^postgres(ql)?:\/\//));
const env = v.parse(
  v.object({ SOURCE_DATABASE_URL: databaseUrl, TARGET_DATABASE_URL: databaseUrl }),
  process.env,
);

async function connect(
  connectionString: string,
): Promise<{ db: Queryable; end: () => Promise<void> }> {
  // Both sessions print timestamps in UTC, or the digests of equal rows differ.
  const client = new pg.Client({ connectionString, options: "-c timezone=UTC" });
  await client.connect();
  return {
    db: {
      query: async (text, params) => ({
        rows: (await client.query(text, [...(params ?? [])])).rows,
      }),
    },
    end: () => client.end(),
  };
}

const [command, flag] = process.argv.slice(2);
const source = await connect(env.SOURCE_DATABASE_URL);
const target = await connect(env.TARGET_DATABASE_URL);
let failed = false;

try {
  const catalog = await readCatalog(source.db, ["public"]);
  const resolution = resolveMappings(tableMappings, catalog);
  const pairs = resolution.selected.map((pair) => ({
    source: pair.source as Table,
    target: pair.target,
  }));

  if (command === "preflight") {
    for (const table of resolution.unmatched) {
      console.log(`unmatched ${table.schema}.${table.name}: no rule selects or excludes it`);
    }
    const findings = preflight(pairs.map((pair) => pair.source));
    for (const finding of findings) {
      console.log(`${finding.severity} ${finding.table}: ${finding.code} (${finding.detail})`);
    }
    failed =
      resolution.unmatched.length > 0 || findings.some((finding) => finding.severity === "blocker");
  } else if (command === "verify") {
    const checks = await compareTables(source.db, target.db, pairs);
    for (const check of checks) {
      console.log(
        `${check.match ? "match " : "DIFFER"} ${check.table}: source ${check.sourceRows}, target ${check.targetRows}`,
      );
    }
    const missing = await missingSecondaryObjects(
      { connection: source.db, schema: "public" },
      { connection: target.db, schema: "app" },
      pairs.map((pair) => pair.source.name),
    );
    for (const object of missing) {
      console.log(`missing on the target: ${object}`);
    }
    failed = missing.length > 0 || checks.some((check) => !check.match);
  } else if (command === "sequences") {
    const plans = await planSequences(source.db, target.db, pairs);
    for (const plan of plans) {
      console.log(
        `${plan.sequence}: source handed out ${plan.sourceHandedOut}, target holds ${plan.targetHighest}, set to ${plan.setTo}`,
      );
    }
    if (flag === "--apply") {
      await applySequences(target.db, plans);
      console.log(`advanced ${plans.length} sequence(s)`);
    } else {
      console.log("nothing changed. Pass --apply to set them.");
    }
  } else {
    console.error("usage: db.ts preflight | verify | sequences [--apply]");
    failed = true;
  }
} finally {
  await source.end();
  await target.end();
}
process.exitCode = failed ? 1 : 0;
