import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { clientConfigFor, TABLE_CALL_POLICY, worstCaseCallMs } from "../src/call-policy.ts";
import { classify } from "../src/errors.ts";
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

const silent = () =>
  new Promise<"still waiting">((resolve) => setTimeout(resolve, 300, "still waiting"));

describe("an endpoint that accepts the request and never answers", () => {
  it("holds a default client for as long as the caller is willing to wait", async () => {
    await against(() => ({ hang: true }));
    const abort = new AbortController();
    const call = client.send(getNote(), { abortSignal: abort.signal }).catch(() => "ended");

    expect(await Promise.race([call, silent()])).toBe("still waiting");
    abort.abort();
    await call;
  });

  it("is not cut off by requestTimeout alone: that setting only warns", async () => {
    const warn = vi.fn();
    await against(() => ({ hang: true }), {
      requestHandler: { requestTimeout: 50, logger: { warn } },
    });
    const abort = new AbortController();
    const call = client.send(getNote(), { abortSignal: abort.signal }).catch(() => "ended");

    expect(await Promise.race([call, silent()])).toBe("still waiting");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("throwOnRequestTimeout=true"));
    expect(endpoint.calls).toHaveLength(1);
    abort.abort();
    await call;
  });

  it("is cut off by requestTimeout with throwOnRequestTimeout, and each attempt is retried", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    await against(() => ({ hang: true }), {
      requestHandler: { requestTimeout: 50, throwOnRequestTimeout: true },
    });

    const error = await client.send(getNote()).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "TimeoutError", $metadata: { attempts: 3 } });
    expect(classify(error)).toEqual({ kind: "unavailable", attempts: 3 });
    // A request that timed out took its connection with it.
    expect(endpoint.calls.map((call) => call.connection)).toEqual([1, 2, 3]);
  });

  it("is bounded by this chapter's policy", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const policy = { maxAttempts: 2, connectionTimeoutMs: 50, requestTimeoutMs: 50 };
    await against(() => ({ hang: true }), clientConfigFor(policy));
    const startedAt = Date.now();

    await expect(client.send(getNote())).rejects.toMatchObject({ name: "TimeoutError" });

    expect(endpoint.calls).toHaveLength(2);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe("AbortSignal", () => {
  it("ends the call at once, and an aborted call is not retried", async () => {
    await against(() => ({ hang: true }));

    const error = await client
      .send(getNote(), { abortSignal: AbortSignal.timeout(50) })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError", $metadata: { attempts: 1 } });
    expect(classify(error)).toEqual({ kind: "aborted" });
    expect(endpoint.calls).toHaveLength(1);
  });

  it("does not cut a backoff wait short: the abort is noticed when the next attempt starts", async () => {
    // The wait before the first retry of a throttled call: 0.8 x 500 ms.
    vi.spyOn(Math, "random").mockReturnValue(0.8);
    await against(() => jsonError(400, "ThrottlingException"));
    const startedAt = Date.now();

    const error = await client
      .send(getNote(), { abortSignal: AbortSignal.timeout(100) })
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(390);
    expect(endpoint.calls).toHaveLength(1);
  });
});

describe("connections", () => {
  it("are kept and reused from one call to the next", async () => {
    await against(() => json({}));

    await client.send(getNote());
    await client.send(getNote());
    await client.send(getNote());

    expect(endpoint.connections()).toBe(1);
  });

  it("are opened side by side for calls in flight together, up to maxSockets", async () => {
    await against(() => json({}), { requestHandler: { httpAgent: { maxSockets: 2 } } });
    // The handler makes its plain-HTTP agent on first use. Real endpoints are HTTPS.
    await client.send(getNote());

    await Promise.all(Array.from({ length: 6 }, () => client.send(getNote())));

    expect(endpoint.connections()).toBe(2);
    expect(endpoint.calls).toHaveLength(7);
  });

  it("are not shared between two clients", async () => {
    await against(() => json({}));
    const other = new DynamoDBClient(localClientConfig(endpoint));

    await client.send(getNote());
    await other.send(getNote());

    expect(endpoint.connections()).toBe(2);
    other.destroy();
  });
});

describe("the longest one send can take under the table policy", () => {
  // Chapter 32's function has 10 seconds.
  const FUNCTION_BUDGET_MS = 10_000;

  it("fits the function's timeout under either retry behaviour", () => {
    expect(worstCaseCallMs(TABLE_CALL_POLICY, false)).toBe(7500);
    expect(worstCaseCallMs(TABLE_CALL_POLICY, true)).toBe(9000);
    expect(worstCaseCallMs(TABLE_CALL_POLICY, true)).toBeLessThan(FUNCTION_BUDGET_MS);
  });

  it("would not fit with the fourth attempt the 2026 behaviour gives DynamoDB by default", () => {
    expect(worstCaseCallMs({ ...TABLE_CALL_POLICY, maxAttempts: 4 }, true)).toBe(15_000);
  });
});
