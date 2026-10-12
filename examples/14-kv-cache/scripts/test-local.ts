// vp run kv:test:local
// A skipped test looks like a pass at a glance, so a store that is not there fails here.

import { spawnSync } from "node:child_process";
import { connect } from "node:net";

const valkeyUrl = process.env["VALKEY_URL"];
const dynamoDbEndpoint = process.env["DYNAMODB_ENDPOINT"];
if (valkeyUrl === undefined || dynamoDbEndpoint === undefined) {
  console.error(
    "VALKEY_URL and DYNAMODB_ENDPOINT must be set. Copy .env.example to .env, then run `vp run kv:local:start` and `vp run kv:local:migrate`.",
  );
  process.exit(1);
}

const answers = (url: URL, defaultPort: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({
      host: url.hostname,
      port: Number(url.port || defaultPort),
      timeout: 2_000,
    });
    socket.once("connect", () => resolve(true)).once("error", () => resolve(false));
    socket.once("timeout", () => resolve(false)).once("close", () => socket.destroy());
    socket.once("connect", () => socket.end());
  });

for (const [name, url, port] of [
  ["Valkey", new URL(valkeyUrl), 6379],
  ["DynamoDB Local", new URL(dynamoDbEndpoint), 8000],
] as const) {
  if (!(await answers(url, port))) {
    console.error(
      `${name} does not answer at ${url.href}. Start it with \`vp run kv:local:start\`.`,
    );
    process.exit(1);
  }
}

const result = spawnSync("vp", ["test", "run", "test/local-stores.test.ts"], { stdio: "inherit" });
process.exit(result.status ?? 1);
