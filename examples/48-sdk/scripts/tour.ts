// One call that is throttled twice and then answered, against a local endpoint, with the
// attempt log switched on. The client is the real one; the endpoint and its answers are ours.
import { AsyncLocalStorage } from "node:async_hooks";

import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";

import { createLogger } from "@aih/example-05-dynamodb/src/log.ts";

import { attemptLogPlugin } from "../src/attempt-log.ts";
import { clientConfigFor, TABLE_CALL_POLICY } from "../src/call-policy.ts";
import { json, jsonError, localClientConfig, startLocalEndpoint } from "../src/local-endpoint.ts";

const endpoint = await startLocalEndpoint((_call, index) =>
  index < 2
    ? jsonError(400, "ProvisionedThroughputExceededException")
    : json({ Item: { pk: { S: "OWNER#u1" }, sk: { S: "NOTE#n1" } } }),
);

// #region wiring
const request = new AsyncLocalStorage<{ requestId: string }>();

// Made once, outside any request. What belongs to a request is looked up when a line is written.
const client = new DynamoDBClient({
  ...localClientConfig(endpoint),
  ...clientConfigFor(TABLE_CALL_POLICY),
});
client.middlewareStack.use(
  attemptLogPlugin({
    log: createLogger("info"),
    requestId: () => request.getStore()?.requestId ?? "none",
    now: Date.now,
  }),
);
// #endregion wiring

try {
  // #region call
  const command = new GetItemCommand({
    TableName: "notes",
    Key: { pk: { S: "OWNER#u1" }, sk: { S: "NOTE#n1" } },
  });
  const output = await request.run({ requestId: "req-1" }, () => client.send(command));
  console.log(JSON.stringify({ attempts: output.$metadata.attempts }));
  // #endregion call
} finally {
  client.destroy();
  await endpoint.close();
}
