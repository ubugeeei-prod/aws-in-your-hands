// vp run test:local:dynamodb
// A skipped test looks like a pass at a glance, so a missing endpoint fails here.
import { spawnSync } from "node:child_process";

const endpoint = process.env["DYNAMODB_ENDPOINT"];
if (endpoint === undefined) {
  console.error(
    "DYNAMODB_ENDPOINT is not set. Copy .env.example to .env, then run `vp run db:local:start` and `vp run db:migrate:local`.",
  );
  process.exit(1);
}
const probe = await fetch(endpoint).catch(() => undefined);
if (probe === undefined) {
  console.error(`Nothing answers at ${endpoint}. Start DynamoDB Local with \`vp run db:local:start\`.`);
  process.exit(1);
}
const result = spawnSync("vp", ["test", "run", "test/dynamodb-local.test.ts"], { stdio: "inherit" });
process.exit(result.status ?? 1);
