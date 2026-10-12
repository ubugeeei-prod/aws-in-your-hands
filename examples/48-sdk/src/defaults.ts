import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DEFAULT_MAX_ATTEMPTS,
  INITIAL_RETRY_TOKENS,
  MAXIMUM_RETRY_DELAY,
  NO_RETRY_INCREMENT,
  Retry,
} from "@smithy/core/retry";
import * as v from "valibot";

import { json, localClientConfig, startLocalEndpoint } from "./local-endpoint.ts";

// #region shape
export const sdkDefaultsSchema = v.strictObject({
  /** Whether this process runs the retry behaviour announced for 2026. */
  retries2026: v.boolean(),
  retryMode: v.string(),
  defaultsMode: v.string(),
  maxAttempts: v.strictObject({ dynamodb: v.number(), s3: v.number(), constant: v.number() }),
  backoff: v.strictObject({
    transientBaseMs: v.number(),
    /** DynamoDB's client is given its own base delay under the 2026 behaviour. */
    dynamodbTransientBaseMs: v.number(),
    throttlingBaseMs: v.number(),
    capMs: v.number(),
  }),
  retryQuota: v.strictObject({
    capacity: v.number(),
    transientRetryCost: v.number(),
    throttlingRetryCost: v.number(),
    refundWithoutRetry: v.number(),
  }),
  // `null` where the handler has no limit at all.
  http: v.strictObject({
    connectionTimeoutMs: v.nullable(v.number()),
    requestTimeoutMs: v.nullable(v.number()),
    socketTimeoutMs: v.nullable(v.number()),
    throwOnRequestTimeout: v.boolean(),
    keepAlive: v.boolean(),
    maxSockets: v.number(),
  }),
});
export type SdkDefaults = v.InferOutput<typeof sdkDefaultsSchema>;
// #endregion shape

// #region pinned
/**
 * What the pinned packages do when nothing is configured: @aws-sdk/client-dynamodb and
 * @aws-sdk/client-s3 3.1149.0, @smithy/core 3.35.2, @smithy/node-http-handler 4.12.1.
 * A test compares this with what the installed packages report, so an upgrade that moves
 * a default fails there before it surprises a function in production.
 */
export const PINNED_DEFAULTS = {
  retries2026: false,
  retryMode: "standard",
  defaultsMode: "legacy",
  maxAttempts: { dynamodb: 3, s3: 3, constant: 3 },
  backoff: {
    transientBaseMs: 100,
    dynamodbTransientBaseMs: 100,
    throttlingBaseMs: 500,
    capMs: 20_000,
  },
  retryQuota: {
    capacity: 500,
    transientRetryCost: 10,
    throttlingRetryCost: 5,
    refundWithoutRetry: 1,
  },
  http: {
    connectionTimeoutMs: null,
    requestTimeoutMs: null,
    socketTimeoutMs: null,
    throwOnRequestTimeout: false,
    keepAlive: true,
    maxSockets: 50,
  },
} as const satisfies SdkDefaults;

/** The same, in a process started with AWS_NEW_RETRIES_2026=true. Only these values move. */
export const PINNED_DEFAULTS_2026 = {
  ...PINNED_DEFAULTS,
  retries2026: true,
  maxAttempts: { dynamodb: 4, s3: 3, constant: 3 },
  backoff: {
    transientBaseMs: 50,
    dynamodbTransientBaseMs: 25,
    throttlingBaseMs: 1000,
    capMs: 20_000,
  },
  retryQuota: { ...PINNED_DEFAULTS.retryQuota, transientRetryCost: 14 },
} as const satisfies SdkDefaults;
// #endregion pinned

// #region read
const agentSchema = v.object({ keepAlive: v.boolean(), maxSockets: v.number() });
const handlerSchema = v.object({
  connectionTimeout: v.optional(v.number()),
  requestTimeout: v.optional(v.number()),
  socketTimeout: v.optional(v.number()),
  throwOnRequestTimeout: v.optional(v.boolean()),
  httpAgent: agentSchema,
});

// A resolved setting is either the value or a function that yields it.
const settled = async <T>(setting: T | (() => Promise<T>)): Promise<T> =>
  typeof setting === "function" ? (setting as () => Promise<T>)() : setting;

const strategySchema = v.object({ baseDelay: v.number() });

const attemptsSent = (header: string | string[] | undefined): number =>
  Number(/max=(\d+)/.exec(String(header))?.[1]);

/**
 * Asks the installed SDK what it does by default. The two clients are given an endpoint, a
 * Region and keys, and nothing else. Each sends one request to a local endpoint, because the
 * number of attempts is only certain once it is on the wire.
 */
export async function readSdkDefaults(): Promise<SdkDefaults> {
  const endpoint = await startLocalEndpoint(() => json({}));
  try {
    const dynamodb = new DynamoDBClient(localClientConfig(endpoint));
    const s3 = new S3Client({ ...localClientConfig(endpoint), forcePathStyle: true });
    await dynamodb.send(new GetItemCommand({ TableName: "notes", Key: { pk: { S: "a" } } }));
    await s3.send(new HeadObjectCommand({ Bucket: "attachments", Key: "a" }));
    const [first, second] = endpoint.calls;
    const requestHandler: object = dynamodb.config.requestHandler;
    const handler = v.parse(
      handlerSchema,
      "httpHandlerConfigs" in requestHandler &&
        typeof requestHandler.httpHandlerConfigs === "function"
        ? requestHandler.httpHandlerConfigs()
        : undefined,
    );
    const defaults = {
      retries2026: Retry.v2026,
      retryMode: await settled(dynamodb.config.retryMode),
      defaultsMode: await settled(dynamodb.config.defaultsMode),
      maxAttempts: {
        dynamodb: attemptsSent(first?.headers["amz-sdk-request"]),
        s3: attemptsSent(second?.headers["amz-sdk-request"]),
        constant: DEFAULT_MAX_ATTEMPTS,
      },
      backoff: {
        transientBaseMs: Retry.delay(),
        dynamodbTransientBaseMs: v.parse(strategySchema, await dynamodb.config.retryStrategy())
          .baseDelay,
        throttlingBaseMs: Retry.throttlingDelay(),
        capMs: MAXIMUM_RETRY_DELAY,
      },
      retryQuota: {
        capacity: INITIAL_RETRY_TOKENS,
        // The two methods are named for the 2026 behaviour, where throttling is the special case.
        // Before it, the special case is the transient error. Read them through that switch.
        transientRetryCost:
          Retry.modifiedCostType() === "TRANSIENT" ? Retry.throttlingCost() : Retry.cost(),
        throttlingRetryCost:
          Retry.modifiedCostType() === "THROTTLING" ? Retry.throttlingCost() : Retry.cost(),
        refundWithoutRetry: NO_RETRY_INCREMENT,
      },
      http: {
        connectionTimeoutMs: handler.connectionTimeout ?? null,
        requestTimeoutMs: handler.requestTimeout ?? null,
        socketTimeoutMs: handler.socketTimeout ?? null,
        throwOnRequestTimeout: handler.throwOnRequestTimeout ?? false,
        keepAlive: handler.httpAgent.keepAlive,
        maxSockets: handler.httpAgent.maxSockets,
      },
    };
    dynamodb.destroy();
    s3.destroy();
    return v.parse(sdkDefaultsSchema, defaults);
  } finally {
    await endpoint.close();
  }
}
// #endregion read
