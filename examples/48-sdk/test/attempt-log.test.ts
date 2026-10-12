import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import * as v from "valibot";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import type { LogEntry } from "@aih/example-05-dynamodb/src/log.ts";

import { ATTEMPT_LOG_MIDDLEWARE, attemptLineSchema, attemptLogPlugin } from "../src/attempt-log.ts";
import {
  json,
  jsonError,
  type LocalEndpoint,
  localClientConfig,
  type Script,
  startLocalEndpoint,
} from "../src/local-endpoint.ts";
import { getNote, isolateSdkEnvironment } from "./support.ts";

beforeAll(() => isolateSdkEnvironment());

let endpoint: LocalEndpoint;
let client: DynamoDBClient;
let entries: LogEntry[];
let currentRequest = "req-1";

async function against(script: Script): Promise<void> {
  vi.spyOn(Math, "random").mockReturnValue(0);
  endpoint = await startLocalEndpoint(script);
  client = new DynamoDBClient(localClientConfig(endpoint));
  entries = [];
  let clock = 0;
  client.middlewareStack.use(
    attemptLogPlugin({
      log: (entry) => entries.push(entry),
      requestId: () => currentRequest,
      // Every reading is 7 ms after the last, so each attempt takes 7 ms.
      now: () => (clock += 7),
    }),
  );
}

afterEach(async () => {
  vi.restoreAllMocks();
  client.destroy();
  await endpoint.close();
});

const lines = () => entries.map((entry) => v.parse(attemptLineSchema, entry));

describe("the attempt log", () => {
  it("writes one line per attempt, each with the request ID the service gave that attempt", async () => {
    await against((_call, index) =>
      index < 2 ? jsonError(400, "ProvisionedThroughputExceededException") : json({}),
    );

    await client.send(getNote());

    expect(lines()).toMatchObject([
      {
        level: "warn",
        attempt: 1,
        maxAttempts: 3,
        status: 400,
        error: "ProvisionedThroughputExceededException",
      },
      { level: "warn", attempt: 2, status: 400 },
      { level: "info", attempt: 3, status: 200, durationMs: 7 },
    ]);
    const ids = lines().map((line) => line.awsRequestId);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id?.startsWith("LOCAL"))).toBe(true);
  });

  it("names the client, the command, and the application's request", async () => {
    await against(() => json({}));
    currentRequest = "req-42";

    await client.send(getNote());

    expect(lines()).toMatchObject([
      { requestId: "req-42", client: "DynamoDBClient", command: "GetItemCommand" },
    ]);
  });

  it("has no status and no request ID when no answer came back", async () => {
    await against(() => ({ hang: true }));

    await client.send(getNote(), { abortSignal: AbortSignal.timeout(30) }).catch(() => undefined);

    expect(lines()).toEqual([
      expect.objectContaining({ level: "warn", attempt: 1, error: "AbortError" }),
    ]);
    expect(lines()[0]).not.toHaveProperty("status");
    expect(lines()[0]).not.toHaveProperty("awsRequestId");
  });

  it("carries nothing of the request or of the service's message", async () => {
    await against(() => jsonError(400, "ValidationException", "key OWNER#u1 is malformed"));

    await client.send(getNote()).catch(() => undefined);

    expect(JSON.stringify(entries)).not.toContain("OWNER#u1");
    expect(JSON.stringify(entries)).not.toContain("AKID");
  });

  it("sits after the retry middleware and the signer, inside the same step", async () => {
    await against(() => json({}));

    const order = client.middlewareStack.identify();
    const position = (name: string) => order.findIndex((entry) => entry.startsWith(name));

    expect(order[position(ATTEMPT_LOG_MIDDLEWARE)]).toBe(
      `${ATTEMPT_LOG_MIDDLEWARE} - finalizeRequest`,
    );
    expect(position("retryMiddleware")).toBeLessThan(position("httpSigningMiddleware"));
    expect(position("httpSigningMiddleware")).toBeLessThan(position(ATTEMPT_LOG_MIDDLEWARE));
    expect(position(ATTEMPT_LOG_MIDDLEWARE)).toBeLessThan(position("deserializerMiddleware"));
  });
});

describe("the stack of a DynamoDB client, as installed", () => {
  it("has these middleware in these steps", async () => {
    await against(() => json({}));
    client.middlewareStack.remove(ATTEMPT_LOG_MIDDLEWARE);

    expect(client.middlewareStack.identify()).toEqual([
      "loggerMiddleware - initialize",
      "serializerMiddleware - serialize",
      "contentLengthMiddleware - build",
      "getUserAgentMiddleware - build",
      "hostHeaderMiddleware - build",
      "recursionDetectionMiddleware - build",
      "retryMiddleware - finalizeRequest",
      "httpSigningMiddleware (a.k.a. apiKeyMiddleware,tokenMiddleware,awsAuthMiddleware) - finalizeRequest",
      "deserializerMiddleware - deserialize",
    ]);
  });
});
