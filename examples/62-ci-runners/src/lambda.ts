import { randomBytes } from "node:crypto";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { ECSClient } from "@aws-sdk/client-ecs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import * as v from "valibot";

import { handleApiGateway } from "@aih/example-04-http-api/src/http/api-gateway.ts";

import { createApp } from "./app.ts";
import { RUNNER, TIMING } from "./config.ts";
import { TRUSTED_EVENTS } from "./decide.ts";
import { dynamoDbClaims } from "./dynamodb-claims.ts";
import { receiverEnvSchema } from "./env.ts";
import { gitHubApp } from "./github.ts";
import { ecsLauncher } from "./launcher.ts";

const env = v.parse(receiverEnvSchema, process.env);
const secrets = new SecretsManagerClient({});

// #region secrets
// Read when needed and never kept: a rotated secret works on the next delivery.
const secret = async (id: string): Promise<string> => {
  const response = await secrets.send(new GetSecretValueCommand({ SecretId: id }));
  if (response.SecretString === undefined || response.SecretString === "") {
    throw new Error("the secret has no string value");
  }
  return response.SecretString;
};
// #endregion secrets

// #region compose
const app = createApp({
  webhookSecret: () => secret(env.WEBHOOK_SECRET_ID),
  policy: {
    // Without an app to sign in as there is nothing to launch with, so nothing is allowed.
    repositories: env.APP_CLIENT_ID === "" ? [] : env.REPOSITORIES,
    label: RUNNER.label,
    events: TRUSTED_EVENTS,
  },
  claims: dynamoDbClaims(DynamoDBDocumentClient.from(new DynamoDBClient({})), env.CLAIMS_TABLE, {
    leaseSeconds: TIMING.claimLease,
    retentionSeconds: TIMING.claimRetention,
  }),
  github: gitHubApp({
    clientId: env.APP_CLIENT_ID,
    privateKey: () => secret(env.APP_KEY_SECRET_ID),
    runnerGroupId: env.RUNNER_GROUP_ID,
    labels: [RUNNER.label],
    fetch,
    now: () => Math.floor(Date.now() / 1000),
  }),
  launcher: ecsLauncher(new ECSClient({}), {
    cluster: env.CLUSTER,
    taskDefinition: env.TASK_DEFINITION,
    subnets: env.SUBNETS,
    securityGroup: env.SECURITY_GROUP,
  }),
  now: () => Math.floor(Date.now() / 1000),
  nonce: () => randomBytes(4).toString("hex"),
  log: (entry) => console.log(JSON.stringify(entry)),
});

// A function URL hands over the same event as an HTTP API: payload format 2.0.
export const handler = handleApiGateway(app);
// #endregion compose
