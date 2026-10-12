import { DynamoDBClient, ProvisionedThroughputExceededException } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

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

async function against(script: Script, config: object = {}): Promise<DynamoDBClient> {
  endpoint = await startLocalEndpoint(script);
  client = new DynamoDBClient({ ...localClientConfig(endpoint), ...config });
  return client;
}

afterEach(async () => {
  vi.restoreAllMocks();
  client.destroy();
  await endpoint.close();
});

/** Full jitter times this is the wait. 0 makes a test instant; 0.5 makes the waits exact. */
const jitter = (value: number) => vi.spyOn(Math, "random").mockReturnValue(value);

describe("a throttled call, with nothing configured", () => {
  it("is sent three times and then handed to the caller as the service's own error", async () => {
    jitter(0);
    await against(() => jsonError(400, "ProvisionedThroughputExceededException"));

    const error = await client.send(getNote()).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ProvisionedThroughputExceededException);
    expect(error).toMatchObject({ $fault: "client", $metadata: { attempts: 3 } });
    expect(endpoint.calls).toHaveLength(3);
  });

  it("tells the service which attempt each request is, under one invocation ID", async () => {
    jitter(0);
    await against(() => jsonError(400, "ThrottlingException"));

    await client.send(getNote()).catch(() => undefined);

    expect(endpoint.calls.map((call) => call.headers["amz-sdk-request"])).toEqual([
      "attempt=1; max=3",
      "attempt=2; max=3",
      "attempt=3; max=3",
    ]);
    expect(new Set(endpoint.calls.map((call) => call.headers["amz-sdk-invocation-id"])).size).toBe(
      1,
    );
    // Signed again each time: the attempt header is part of what is signed.
    expect(new Set(endpoint.calls.map((call) => call.headers.authorization)).size).toBe(3);
  });

  it("reports the attempts and the time spent waiting on a call that got through", async () => {
    jitter(0.5);
    await against((_call, index) => (index < 2 ? jsonError(400, "ThrottlingException") : json({})));

    const output = await client.send(getNote());

    // Half of 500 ms, then half of 1,000 ms.
    expect(output.$metadata).toMatchObject({ attempts: 3, totalRetryDelay: 750 });
  });

  it("waits a fifth as long after an error that is not throttling", async () => {
    jitter(0.5);
    await against((_call, index) => (index < 2 ? jsonError(500, "InternalServerError") : json({})));

    const output = await client.send(getNote());

    // Half of 100 ms, then half of 200 ms.
    expect(output.$metadata).toMatchObject({ attempts: 3, totalRetryDelay: 150 });
  });
});

describe("which answers are sent again", () => {
  it.each([
    [400, "ProvisionedThroughputExceededException"],
    [400, "ThrottlingException"],
    [400, "RequestLimitExceeded"],
    // The status alone is enough, whatever the code says.
    [429, "SomethingNobodyListed"],
    [500, "InternalServerError"],
    [503, "ServiceUnavailable"],
  ])("%i %s: retried", async (status, code) => {
    jitter(0);
    await against(() => jsonError(status, code));

    await expect(client.send(getNote())).rejects.toMatchObject({ name: code });
    expect(endpoint.calls).toHaveLength(3);
  });

  it.each([
    [400, "ValidationException"],
    [400, "ConditionalCheckFailedException"],
    [400, "ResourceNotFoundException"],
    [400, "TransactionConflictException"],
    [400, "AccessDeniedException"],
    [400, "UnrecognizedClientException"],
  ])("%i %s: sent once", async (status, code) => {
    await against(() => jsonError(status, code));

    await expect(client.send(getNote())).rejects.toMatchObject({
      name: code,
      $metadata: { attempts: 1 },
    });
    expect(endpoint.calls).toHaveLength(1);
  });

  it("a connection that is refused: retried, with no answer to show for it", async () => {
    jitter(0);
    await against(() => json({}));
    const url = endpoint.url;
    await endpoint.close();
    client = new DynamoDBClient(localClientConfig({ url }));

    await expect(client.send(getNote())).rejects.toMatchObject({
      code: "ECONNREFUSED",
      $metadata: { attempts: 3 },
    });
  });
});

describe("settings that change the count", () => {
  it("maxAttempts: 1 is one request and no retry", async () => {
    await against(() => jsonError(400, "ThrottlingException"), { maxAttempts: 1 });

    await expect(client.send(getNote())).rejects.toMatchObject({ $metadata: { attempts: 1 } });
    expect(endpoint.calls).toHaveLength(1);
  });

  it("a wait the service asks for in x-amz-retry-after is honoured", async () => {
    jitter(0);
    await against(
      (_call, index) =>
        index === 0
          ? jsonError(400, "ThrottlingException", "slow down", { "x-amz-retry-after": "200" })
          : json({}),
      { maxAttempts: 2 },
    );

    const output = await client.send(getNote());

    // Jitter alone would have made it 0. The header is in milliseconds.
    expect(output.$metadata.totalRetryDelay).toBeGreaterThan(150);
    expect(output.$metadata.totalRetryDelay).toBeLessThanOrEqual(200);
  });
});

describe("the retry quota of one client", () => {
  it("stops retrying once failures have drained it, and comes back with successes", async () => {
    jitter(0);
    let healthy = false;
    await against(() => (healthy ? json({}) : jsonError(400, "ThrottlingException")));
    const attemptsOfNextCall = async () => {
      const before = endpoint.calls.length;
      await client.send(getNote()).catch(() => undefined);
      return endpoint.calls.length - before;
    };

    // 500 tokens; a throttled retry costs 5; a call that fails three times spends 10.
    for (let call = 0; call < 50; call++) {
      expect(await attemptsOfNextCall()).toBe(3);
    }
    expect(await attemptsOfNextCall()).toBe(1);

    // A success without a retry gives 1 back. Five of them pay for one retry.
    healthy = true;
    for (let call = 0; call < 5; call++) {
      await client.send(getNote());
    }
    healthy = false;
    expect(await attemptsOfNextCall()).toBe(2);
  });

  it("is not shared: a second client starts full", async () => {
    jitter(0);
    await against(() => jsonError(400, "ThrottlingException"));
    for (let call = 0; call < 50; call++) {
      await client.send(getNote()).catch(() => undefined);
    }
    const other = new DynamoDBClient(localClientConfig(endpoint));
    const before = endpoint.calls.length;

    await other.send(getNote()).catch(() => undefined);

    expect(endpoint.calls.length - before).toBe(3);
    other.destroy();
  });
});
