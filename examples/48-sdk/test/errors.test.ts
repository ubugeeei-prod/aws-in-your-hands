import {
  ConditionalCheckFailedException,
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { classify, toResponse } from "../src/errors.ts";
import {
  jsonError,
  type LocalEndpoint,
  localClientConfig,
  startLocalEndpoint,
} from "../src/local-endpoint.ts";
import { getNote, isolateSdkEnvironment } from "./support.ts";

beforeAll(() => isolateSdkEnvironment());

let endpoint: LocalEndpoint;
let client: DynamoDBClient;

async function failure(status: number, code: string): Promise<unknown> {
  vi.spyOn(Math, "random").mockReturnValue(0);
  endpoint = await startLocalEndpoint(() =>
    jsonError(status, code, "the table notes-prod, key u1"),
  );
  client = new DynamoDBClient(localClientConfig(endpoint));
  return client.send(getNote()).catch((thrown: unknown) => thrown);
}

afterEach(async () => {
  vi.restoreAllMocks();
  client.destroy();
  await endpoint.close();
});

describe("an error the service returned", () => {
  it("is an instance of its own class and of the service's base class", async () => {
    const error = await failure(400, "ConditionalCheckFailedException");

    expect(error).toBeInstanceOf(ConditionalCheckFailedException);
    expect(error).toBeInstanceOf(DynamoDBServiceException);
    expect(error).toBeInstanceOf(Error);
  });

  it("carries the fault, the status and the service's request ID", async () => {
    const error = await failure(400, "ConditionalCheckFailedException");

    expect(error).toMatchObject({
      name: "ConditionalCheckFailedException",
      $fault: "client",
      $metadata: { httpStatusCode: 400, requestId: expect.stringMatching(/^LOCAL\d+$/) },
    });
  });

  it("with a code the client has no class for is the base class, named after the code", async () => {
    const error = await failure(400, "BrandNewException");

    expect(error).toBeInstanceOf(DynamoDBServiceException);
    expect(error).toMatchObject({ name: "BrandNewException", $fault: "client" });
  });
});

describe("classify", () => {
  it.each([
    [400, "ProvisionedThroughputExceededException", { kind: "throttled", attempts: 3 }],
    [400, "ThrottlingException", { kind: "throttled", attempts: 3 }],
    [429, "BrandNewException", { kind: "throttled", attempts: 3 }],
    [500, "InternalServerError", { kind: "unavailable", attempts: 3 }],
    [503, "BrandNewException", { kind: "unavailable", attempts: 3 }],
    [400, "ValidationException", { kind: "rejected", name: "ValidationException", status: 400 }],
    [
      400,
      "ResourceNotFoundException",
      { kind: "rejected", name: "ResourceNotFoundException", status: 400 },
    ],
    [
      400,
      "AccessDeniedException",
      { kind: "rejected", name: "AccessDeniedException", status: 400 },
    ],
  ])("%i %s", async (status, code, expected) => {
    expect(classify(await failure(status, code))).toEqual(expected);
  });

  it("knows nothing about a value the SDK did not throw", async () => {
    await failure(400, "ValidationException");

    expect(classify(new Error("boom"))).toEqual({ kind: "unknown" });
    expect(classify("boom")).toEqual({ kind: "unknown" });
    expect(classify({ name: "ThrottlingException" })).toEqual({ kind: "unknown" });
  });
});

describe("what the API answers", () => {
  it("is a 503 with Retry-After for a refusal the caller can wait out", async () => {
    const response = toResponse(classify(await failure(400, "ThrottlingException")));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("1");
  });

  it("never repeats the service's message", async () => {
    const response = toResponse(classify(await failure(400, "ValidationException")));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("notes-prod");
  });
});
