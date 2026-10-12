import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_MODE,
  INITIAL_RETRY_TOKENS,
  MAXIMUM_RETRY_DELAY,
  NO_RETRY_INCREMENT,
  RETRY_COST,
  THROTTLING_RETRY_DELAY_BASE,
} from "@smithy/util-retry";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { worstCaseWaitMs } from "../src/backoff.ts";
import {
  SDK_2026_THROTTLING_BACKOFF,
  SDK_RETRY_BUDGET,
  SDK_THROTTLING_BACKOFF,
  TABLE_CLIENT_RETRY,
} from "../src/sdk-retry.ts";

// Answers every request the way DynamoDB answers a refused one. Nothing leaves the process.
function refusing(errorType: string) {
  const handler = {
    calls: 0,
    metadata: { handlerProtocol: "http/1.1" },
    async handle() {
      handler.calls += 1;
      return {
        response: {
          statusCode: 400,
          headers: { "content-type": "application/x-amz-json-1.0" },
          body: new TextEncoder().encode(
            JSON.stringify({
              __type: `com.amazonaws.dynamodb.v20120810#${errorType}`,
              message: "refused by the test",
            }),
          ),
        },
      };
    },
    updateHttpClientConfig() {},
    httpHandlerConfigs: () => ({}),
  };
  return handler;
}

const client = (handler: ReturnType<typeof refusing>, config: object = TABLE_CLIENT_RETRY) =>
  new DynamoDBClient({
    ...config,
    region: "ap-northeast-1",
    credentials: { accessKeyId: "test", secretAccessKey: "test" },
    requestHandler: handler,
  });

const getItem = new GetItemCommand({ TableName: "notes", Key: { pk: { S: "a" }, sk: { S: "b" } } });

describe("the installed SDK, when DynamoDB throttles", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends a throttled call three times in all, then hands the error to the caller", async () => {
    // Full jitter times zero is no wait: the test does not sleep.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const handler = refusing("ProvisionedThroughputExceededException");

    await expect(client(handler).send(getItem)).rejects.toMatchObject({
      name: "ProvisionedThroughputExceededException",
      $metadata: { attempts: 3 },
    });
    expect(handler.calls).toBe(3);
  });

  it("sends a call that cannot succeed once", async () => {
    const handler = refusing("ValidationException");

    await expect(client(handler).send(getItem)).rejects.toMatchObject({
      name: "ValidationException",
    });
    expect(handler.calls).toBe(1);
  });

  it("does not retry at all when told to make one attempt", async () => {
    const handler = refusing("ThrottlingException");

    await expect(client(handler, { maxAttempts: 1 }).send(getItem)).rejects.toMatchObject({
      name: "ThrottlingException",
    });
    expect(handler.calls).toBe(1);
  });
});

describe("the numbers this chapter quotes", () => {
  it("are the ones the installed package exports", () => {
    expect(DEFAULT_RETRY_MODE).toBe(TABLE_CLIENT_RETRY.retryMode);
    expect(DEFAULT_MAX_ATTEMPTS).toBe(TABLE_CLIENT_RETRY.maxAttempts);
    expect(SDK_THROTTLING_BACKOFF).toMatchObject({
      baseMs: THROTTLING_RETRY_DELAY_BASE,
      capMs: MAXIMUM_RETRY_DELAY,
    });
    expect(SDK_RETRY_BUDGET).toEqual({
      capacity: INITIAL_RETRY_TOKENS,
      retryCost: RETRY_COST,
      successRefund: NO_RETRY_INCREMENT,
    });
  });

  it("leave the function's 10 seconds room for three attempts, under either behaviour", () => {
    expect(worstCaseWaitMs(SDK_THROTTLING_BACKOFF, TABLE_CLIENT_RETRY.maxAttempts)).toBe(1500);
    expect(worstCaseWaitMs(SDK_2026_THROTTLING_BACKOFF, TABLE_CLIENT_RETRY.maxAttempts)).toBe(3000);
    // A fourth attempt under the 2026 behaviour would add up to 4 more seconds.
    expect(worstCaseWaitMs(SDK_2026_THROTTLING_BACKOFF, 4)).toBe(7000);
  });
});
