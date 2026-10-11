// vp run test:local:dynamodb
//
// Runs the repository contract against DynamoDB Local. The test file skips
// itself when DYNAMODB_ENDPOINT is missing, and a skipped test looks like a
// pass at a glance, so this wrapper makes the missing endpoint a failure.
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
